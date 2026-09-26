# English Learning Platform

An English learning web app with Firebase Authentication and Firestore, daily challenges, vocabulary lists, and AI generated reading exercises. The server uses Express and DeepSeek; the frontend is served from `public/`.

## Local setup

1. Install Node.js and run `npm ci` in this directory.
2. Copy `.env.example` to `.env` and fill in your own Firebase web configuration and DeepSeek API key.
3. Download a Firebase Admin service account for your own Firebase project and save it as `serviceAccountKey.json` in this directory. Alternatively, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete JSON string.
4. Enable Firebase Authentication and Firestore for the Firebase project.
5. Run `node index.js` and open `http://localhost:3000`.

## Deployment

The included `vercel.json` serves the frontend and API. Configure `DEEPSEEK_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and the Firebase web configuration values from `.env.example` as environment variables in the deployment platform. Keep the Admin service account and DeepSeek key in secret storage. Firebase web configuration is sent to browsers by `/api/config/firebase` and must be protected through Firebase security rules and authorized domains, as applicable.

## Repository safety

`.env`, service account JSON files, local Vercel settings, and dependencies are excluded from Git. Never paste real credentials into source files or `.env.example`. Before making a repository public, inspect the files listed by `git ls-files` and scan each new commit for secrets. If a credential is ever committed or exposed, revoke and replace it at the provider; deleting the file from a later commit does not remove it from Git history.
