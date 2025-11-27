const { app } = require('@azure/functions');
const Papa = require('papaparse');
const { CosmosClient } = require('@azure/cosmos');

// Initialize the Database Client
const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);

app.storageBlob('processDietsCsv', {
    path: 'uploads/{name}',
    connection: 'AzureWebJobsStorage',
    handler: async (blob, context) => {
        context.log(`Processing file: ${context.triggerMetadata.name}`);

        // 1. READ & PARSE
        const csvString = blob.toString();
        const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true });
        const rawData = parsed.data;

        // 2. CLEAN DATA
        const uniqueRecipes = new Map();

        rawData.forEach(row => {
            if (!row.Recipe_name || row.Recipe_name.trim() === "") return;

            const cleanTitle = row.Recipe_name.trim();
            const cleanDiet = row.Diet_type ? row.Diet_type.trim().toLowerCase() : 'unknown';
            const cleanCuisine = row.Cuisine_type ? row.Cuisine_type.trim() : 'General';

            if (!uniqueRecipes.has(cleanTitle)) {
                uniqueRecipes.set(cleanTitle, {
                    id: cleanTitle.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(), // Create a URL-friendly ID
                    Title: cleanTitle,
                    Diet: cleanDiet,
                    Cuisine: cleanCuisine,
                    Protein: row['Protein(g)'],
                    Carbs: row['Carbs(g)'],
                    Fat: row['Fat(g)']
                });
            }
        });

        const cleanedData = Array.from(uniqueRecipes.values());

        // 3. CALCULATE STATS
        const dietCounts = {};
        cleanedData.forEach(recipe => {
            const diet = recipe.Diet;
            dietCounts[diet] = (dietCounts[diet] || 0) + 1;
        });

        // 4. SAVE TO COSMOS DB
        context.log("Saving to Cosmos DB...");

        // Create Database and Containers if they don't exist
        const { database } = await client.databases.createIfNotExists({ id: "RecipeDB" });
        const { container: recipesContainer } = await database.containers.createIfNotExists({ id: "Recipes" });
        const { container: statsContainer } = await database.containers.createIfNotExists({ id: "Stats" });

        // Save Stats (Upsert = Update if exists, Insert if new)
        await statsContainer.items.upsert({
            id: "dashboard-stats",
            dietCounts: dietCounts,
            lastUpdated: new Date().toISOString()
        });
        context.log("Stats saved successfully.");

        // Save Recipes (Batching simplified for homework)
        // We will save just the first 50 as a test to save time, 
        // but in production you'd loop through all of them.
        let count = 0;
        for (const recipe of cleanedData.slice(0, 50)) {
            await recipesContainer.items.upsert(recipe);
            count++;
        }

        context.log(`Saved ${count} recipes to the database.`);
        context.log("--------------------------------------------------");
    }
});