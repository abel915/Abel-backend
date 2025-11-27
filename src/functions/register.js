const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const { CosmosClient } = require('@azure/cosmos');

// Connect to Database
const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);

app.http('register', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // 1. Get user input
            const body = await request.json();
            const { name, email, password } = body;

            if (!name || !email || !password) {
                return { status: 400, body: "Please provide name, email, and password." };
            }

            // 2. Check if user already exists
            const container = client.database('RecipeDB').container('Users');
            // Create Users container if it doesn't exist yet
            await client.database('RecipeDB').containers.createIfNotExists({ id: "Users" });

            const { resources: existingUsers } = await container.items
                .query({
                    query: "SELECT * FROM c WHERE c.email = @email",
                    parameters: [{ name: "@email", value: email }]
                })
                .fetchAll();

            if (existingUsers.length > 0) {
                return { status: 409, body: "User with this email already exists." };
            }

            // 3. Hash the password (Security Best Practice)
            const hashedPassword = await bcrypt.hash(password, 10);

            // 4. Save to Database
            const newUser = {
                id: email.replace(/[^a-zA-Z0-9]/g, ''), // Simple ID
                name: name,
                email: email,
                password: hashedPassword,
                createdAt: new Date().toISOString()
            };

            await container.items.create(newUser);

            return { status: 201, jsonBody: { message: "User registered successfully!" } };

        } catch (error) {
            context.log(error);
            return { status: 500, body: "Internal Server Error" };
        }
    }
});