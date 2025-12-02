const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const jwt = require('jsonwebtoken');

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const SECRET_KEY = process.env.JWT_SECRET || "fallback_secret_key_123";

app.http('recipes', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'recipes',
    handler: async (request, context) => {
        // --------------------------------------------------
        // 1. SECURITY: Check JWT
        // --------------------------------------------------
        const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { status: 401, jsonBody: { error: 'Missing Authorization header' } };
        }

        const token = authHeader.substring('Bearer '.length);

        try {
            jwt.verify(token, SECRET_KEY);
        } catch (err) {
            return { status: 401, jsonBody: { error: 'Invalid or expired token' } };
        }

        // --------------------------------------------------
        // 2. PREPARE PARAMETERS
        // --------------------------------------------------
        const dietRaw = (request.query.get('diet') || '').trim();
        const dietLower = dietRaw.toLowerCase();
        const keyword = (request.query.get('keyword') || '').trim().toLowerCase();

        const page = parseInt(request.query.get('page') || '1');
        const pageSize = parseInt(request.query.get('pageSize') || '10');
        const offset = (page - 1) * pageSize;

        // --------------------------------------------------
        // 3. BUILD QUERY (Mapping DB names to Frontend names)
        //    DB uses: Title, Diet, Cuisine
        //    Frontend wants: Recipe_name, Diet_type, Cuisine_type
        // --------------------------------------------------

        // We select specific fields and rename them for the frontend
        let queryText = `
            SELECT 
                c.id, 
                c.Title as Recipe_name, 
                c.Diet as Diet_type, 
                c.Cuisine as Cuisine_type, 
                c.Protein, 
                c.Carbs, 
                c.Fat 
            FROM c 
            WHERE 1=1`;

        const parameters = [];

        // Correct DB Field: "Diet"
        if (dietRaw && dietLower !== 'all') {
            queryText += ' AND c.Diet = @diet';
            parameters.push({ name: '@diet', value: dietLower });
        }

        // Correct DB Field: "Title"
        if (keyword) {
            queryText += ' AND CONTAINS(LOWER(c.Title), @keyword)';
            parameters.push({ name: '@keyword', value: keyword });
        }

        // --------------------------------------------------
        // 4. EXECUTE QUERY
        // --------------------------------------------------
        try {
            const container = client.database('RecipeDB').container('Recipes');

            // Fetch all matching items
            const { resources: allItems } = await container.items
                .query({ query: queryText, parameters: parameters })
                .fetchAll();

            const total = allItems.length;

            // --------------------------------------------------
            // 5. PAGINATION (Slice the array)
            // --------------------------------------------------
            const pagedItems = allItems.slice(offset, offset + pageSize);

            // --------------------------------------------------
            // 6. RETURN RESPONSE
            // --------------------------------------------------
            return {
                status: 200,
                jsonBody: {
                    page: page,
                    pageSize: pageSize,
                    total: total,
                    totalPages: Math.ceil(total / pageSize),
                    data: pagedItems // Now contains Recipe_name, Diet_type, etc.
                }
            };

        } catch (error) {
            context.log('Error in /api/recipes:', error);
            return { status: 500, jsonBody: { error: 'Database error' } };
        }
    }
});