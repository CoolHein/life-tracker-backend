# Life Tracker AI Backend

Backend API for the Five Pillars Life Tracker application with AI coaching and user authentication.

## Features

- User authentication (signup, login, JWT tokens)
- MongoDB data persistence
- AI-powered life coaching
- Google Docs integration
- Secure user data management

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. Run locally: `npm run dev`

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key
- `GOOGLE_CREDENTIALS`: Google service account credentials JSON
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `PORT`: Server port (default: 3000)

## Deployment to Render

1. Connect your GitHub repository
2. Set all environment variables in Render dashboard
3. Deploy!

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new account
- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verify token

### User Data
- `GET /api/user/data` - Get user data (protected)
- `POST /api/user/data` - Save user data (protected)

### AI & Documents
- `POST /api/ai-coach` - Get AI coaching response
- `GET /api/documents-status` - Check document status
- `POST /api/search-documents` - Search documents
