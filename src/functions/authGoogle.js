const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const SECRET_KEY = process.env.JWT_SECRET || "fallback_secret_key_123";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// 1) /api/auth/google - start Google login (redirect user to Google)
app.http('auth-google', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/google',
    handler: async (request, context) => {
        try {
            if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
                return {
                    status: 500,
                    jsonBody: { error: 'Google OAuth is not configured on the server.' }
                };
            }

            const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
            url.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('scope', 'openid email profile');
            url.searchParams.set('access_type', 'offline');
            url.searchParams.set('prompt', 'consent');

            // 302 redirect to Google
            return {
                status: 302,
                headers: {
                    Location: url.toString()
                }
            };
        } catch (error) {
            context.log('Error starting Google auth:', error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to start Google authentication.' }
            };
        }
    }
});

// 2) /api/auth/google/callback - finish login, create/find user, return JWT
app.http('auth-google-callback', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/google/callback',
    handler: async (request, context) => {
        try {
            const code = request.query.get('code');

            if (!code) {
                return { status: 400, jsonBody: { error: 'Missing "code" query parameter.' } };
            }

            // Exchange code for tokens with Google
            const params = new URLSearchParams();
            params.append('code', code);
            params.append('client_id', GOOGLE_CLIENT_ID);
            params.append('client_secret', GOOGLE_CLIENT_SECRET);
            params.append('redirect_uri', GOOGLE_REDIRECT_URI);
            params.append('grant_type', 'authorization_code');

            const tokenResponse = await axios.post(
                'https://oauth2.googleapis.com/token',
                params.toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            const { id_token } = tokenResponse.data;

            if (!id_token) {
                return { status: 500, jsonBody: { error: 'No id_token returned from Google.' } };
            }

            // Decode id_token to get user info (email, name)
            const googleUser = jwt.decode(id_token);

            if (!googleUser || !googleUser.email) {
                return { status: 500, jsonBody: { error: 'Unable to read Google user information.' } };
            }

            const email = googleUser.email;
            const name = googleUser.name || email.split('@')[0];

            // Find or create the user in Cosmos DB (Users container)
            const usersContainer = client.database('RecipeDB').container('Users');

            const querySpec = {
                query: 'SELECT * FROM c WHERE c.email = @email',
                parameters: [{ name: '@email', value: email }]
            };

            const { resources } = await usersContainer.items.query(querySpec).fetchAll();
            let user = resources[0];

            if (!user) {
                // Create a new user record for Google login
                user = {
                    id: email,                // simple id
                    name: name,
                    email: email,
                    password: null,           // no password for Google accounts
                    provider: 'google',
                    createdAt: new Date().toISOString()
                };

                await usersContainer.items.create(user);
            }

            // Create our own JWT for the app (same style as normal login)
            const appToken = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    name: user.name
                },
                SECRET_KEY,
                { expiresIn: '2h' }
            );

            // Return JSON so frontend can use it like normal login
            return {
                status: 200,
                jsonBody: {
                    message: 'Google login successful',
                    token: appToken,
                    username: user.name
                }
            };
        } catch (error) {
            context.log('Error in Google callback:', error?.response?.data || error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to complete Google authentication.' }
            };
        }
    }
});
