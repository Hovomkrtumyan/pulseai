# PulseAi - AI-Powered Logic Analyzer

PulseAi is a web application that uses AI to analyze logic analyzer CSV files and identify communication protocols, devices, and pin mappings.

## Features

- Upload CSV files from Saleae Logic or similar analyzers
- AI-powered protocol analysis using DeepSeek
- Device identification and pin mapping
- Modern, responsive web interface
- Analysis history tracking (with MongoDB)

## Deployment

This app is configured for deployment on Render.com with MongoDB Atlas.

### Environment Variables

- `DEEPSEEK_API_KEY`: Your DeepSeek API key
- `MONGODB_URI`: MongoDB Atlas connection string (optional)
- `NODE_ENV`: Set to 'production'

### Local Development

1. Clone the repository
2. Run `npm install`
3. Create `.env` file from `.env.example`
4. Run `npm run dev`

### Production Deployment

1. Push code to GitHub
2. Connect repository to Render
3. Set environment variables in Render dashboard
4. Deploy!

## API Endpoints

- `POST /api/analyze` - Analyze CSV file
- `GET /api/health` - Health check
- `GET /api/test-deepseek` - Test DeepSeek API connection
- `GET /api/analytics` - Get usage analytics (if MongoDB configured)

## Technology Stack

- Backend: Node.js, Express
- Frontend: HTML, CSS, JavaScript
- AI: DeepSeek API
- Database: MongoDB Atlas (optional)
- Deployment: Render.com