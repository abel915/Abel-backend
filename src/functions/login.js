const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const SECRET_KEY = process.env.JWT_SECRET || "fallback_secret_key_123";

app.http('login', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const { email, password } = await request.json();

            const container = client.database('RecipeDB').container('Users');

            // 1. Find the user
            const { resources: users } = await container.items
                .query({
                    query: "SELECT * FROM c WHERE c.email = @email",
                    parameters: [{ name: "@email", value: email }]
                })
                .fetchAll();

            if (users.length === 0) {
                return { status: 401, body: "Invalid email or password." };
            }

            const user = users[0];

            // 2. Check Password
            const isValid = await bcrypt.compare(password, user.password);
            if (!isValid) {
                return { status: 401, body: "Invalid email or password." };
            }

            // 3. Generate Token
            const token = jwt.sign(
                { userId: user.id, email: user.email, name: user.name },
                SECRET_KEY,
                { expiresIn: '2h' }
            );

            // 4. Return success
            return {
                status: 200,
                jsonBody: {
                    message: "Login successful",
                    token: token,
                    username: user.name
                }
            };

        } catch (error) {
            context.log(error);
            return { status: 500, body: "Server Error" };
        }
    }
});