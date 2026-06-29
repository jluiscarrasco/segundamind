# SecondaMind — Personal Knowledge Management System

## About

SecondaMind is a comprehensive personal knowledge management application built with React, TypeScript, and Firebase. It provides:
- Task management with areas, projects, and tasks
- Knowledge base with wiki pages and resources
- Inbox/quick capture for notes and links
- File storage with folder management
- Real-time synchronization
- AI-powered features (wiki generation, content analysis)
- Push notifications

## Setup

**Prerequisites**: Node.js & npm installed

**Installation**:

```sh
# Clone the repository
git clone https://github.com/clarevion/segundamind.git

# Navigate to project
cd segundamind

# Install dependencies
npm install

# Configure Firebase (see Configuration section below)

# Start development server
npm run dev
```

The app will be available at `http://localhost:8082`

## Configuration

### Firebase Setup

1. Create a Firebase project at [https://console.firebase.google.com](https://console.firebase.google.com)
2. Enable these services:
   - Authentication (Email/Password)
   - Firestore Database
   - Cloud Storage
   - Cloud Functions
3. Get your configuration from Project Settings
4. Create `.env` file with your Firebase credentials:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com

# AI Features (Google Gemini API)
VITE_GEMINI_API_KEY=your_gemini_api_key

# Web Push Notifications
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key

# Other
APP_BASE_URL=http://localhost:8082
```

5. Setup Firestore Security Rules and Cloud Functions (see deployment section)

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
