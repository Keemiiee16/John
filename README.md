# John Economy Bot — Flat GitHub Upload

All files are intentionally in the ROOT of this package so you can upload them directly through GitHub's web interface without needing to upload folders.

## Upload these files to the root of your GitHub repo
- index.js
- db.js
- commands.js
- receipts.js
- utils.js
- package.json
- .env.example
- README.md
- all PNG template files
- all SQL backup/patch files

## Render / hosting start command
npm start

## Environment variables
DISCORD_TOKEN
DISCORD_CLIENT_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PORT=3000
REGISTER_COMMANDS=true

The Supabase SQL files are included for backup/reference. You already ran the main setup and patches successfully.