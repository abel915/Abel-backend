const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const jwt = require('jsonwebtoken');

// Same connection + secret style as login/register
const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const SECRET_KEY = process.env.JWT_SECRET || "fallback_secret_key_123";

// HTTP trigger: GET /api/recipes
app.http('recipes', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // --------------------------------------------------
            // 1. Check JWT token in Authorization header
            // --------------------------------------------------
            const authHeader =
                request.headers.get('authorization') ||
                request.headers.get('Authorization');

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return {
                    status: 401,
                    jsonBody: { error: 'Missing or invalid Authorization header' }
                };
            }

            const token = authHeader.substring('Bearer '.length);

            try {
                // Will throw if token is invalid/expired
                jwt.verify(token, SECRET_KEY);
            } catch (err) {
                return {
                    status: 401,
                    jsonBody: { error: 'Invalid or expired token' }
                };
            }

            // --------------------------------------------------
            // 2. Read query params: diet, keyword, page, pageSize
            // --------------------------------------------------
            const dietRaw = (request.query.get('diet') || '').trim();
            const dietLower = dietRaw.toLowerCase();
            const keyword = (request.query.get('keyword') || '').trim().toLowerCase();

            const page = parseInt(request.query.get('page') || '1', 10);
            const pageSize = parseInt(request.query.get('pageSize') || '10', 10);

            const safePage = page > 0 ? page : 1;
            const safePageSize = pageSize > 0 ? pageSize : 10;

            // --------------------------------------------------
            // 3. Build Cosmos DB query
            //    Recipes look like:
            //    { id, Title, Diet, Cuisine, Protein, Carbs, Fat }
            // --------------------------------------------------
            let queryText = 'SELECT * FROM c WHERE 1=1';
            const parameters = [];

            // Filter by diet (if provided and not "all")
            if (dietRaw && dietLower !== 'all') {
                // Diet is stored in lower-case in Cosmos
                queryText += ' AND c.Diet = @diet';
                parameters.push({ name: '@diet', value: dietLower });
            }

            // Keyword search in Title
            if (keyword) {
                queryText += ' AND CONTAINS(LOWER(c.Title), @keyword)';
                parameters.push({ name: '@keyword', value: keyword });
            }

            const querySpec = { query: queryText, parameters };

            // --------------------------------------------------
            // 4. Query Cosmos DB (RecipeDB / Recipes)
            // --------------------------------------------------
            const container = client
                .database('RecipeDB')
                .container('Recipes');

            const { resources: allItems } = await container.items
                .query(querySpec)
                .fetchAll();

            const total = allItems.length;

            // --------------------------------------------------
            // 5. Apply pagination in code
            // --------------------------------------------------
            const startIndex = (safePage - 1) * safePageSize;
            const pagedItems = allItems.slice(
                startIndex,
                startIndex + safePageSize
            );

            // --------------------------------------------------
            // 6. Return JSON response for frontend
            // --------------------------------------------------
            return {
                status: 200,
                jsonBody: {
                    page: safePage,
                    pageSize: safePageSize,
                    total,
                    totalPages: Math.ceil(total / safePageSize),
                    data: pagedItems
                }
            };
        } catch (error) {
            context.log('Error in /api/recipes:', error);
            return {
                status: 500,
                jsonBody: { error: 'Server error while fetching recipes' }
            };
        }
    }
});
