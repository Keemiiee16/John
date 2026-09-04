# John — Vortex Economy Bot

This folder is the GitHub-ready John project.

## What's included

### Core John systems
- Global multi-character system
- Server-specific active character selection
- Nova / Voro economy
- Equity Financial banking
- Checking and Savings
- Transactions
- Jobs and payroll foundation
- Businesses and employee foundation
- Properties and housing foundation
- Vehicles / driving foundation
- Shops / restaurants foundation
- Subscriptions and subscription actions
- `/fire` database support
- Admin/economy foundation

### Apps
- Vantage
- VYLT
- VYBE
- NABIT
- PAR-T GO

### Included visual assets
- Equity Financial logo
- Equity Financial transaction template
- VYLT receipt template
- NABIT receipt/tracking template
- VYBE driver template
- Vantage + Kinetix order template
- PAR-T booked ticket template

## IMPORTANT: Supabase

Your successful consolidated database is:

`sql/john_complete_database.sql`

That is now the database source of truth. Do not run the older patch files on top of it.

If you already ran the fixed complete SQL in Supabase and received SUCCESS, you do not need to run it again.

## GitHub upload

Upload the CONTENTS of this folder to the root of your GitHub repository.

The repository root should look like:

```text
assets/
sql/
.env.example
.gitignore
package.json
README.md
render.yaml
```

Do NOT upload a real `.env` file or any secret keys.

## Render environment variables

Add these in Render:

```text
DISCORD_TOKEN
DISCORD_CLIENT_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
REGISTER_COMMANDS=true
```

The Supabase service-role key must stay private and server-side.

## Render deployment

This project contains `render.yaml`.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Health endpoint:

```text
/health
```

## Current slash-command structure

- `/character`
- `/me`
- `/bank`
- `/vehicle`
- `/drive`
- `/property`
- `/job`
- `/subscriptions`
- `/action`
- `/shop`
- `/apps`
- `/business`
- `/fire`
- `/notifications`
- `/create`
- `/manage`
- `/admin`

### `/character`
Includes:
- Create
- Switch
- View
- Edit
- Remove

Remove requires the player to type the character's name exactly before deletion.

### `/apps`
Contains:
- Vantage
- VYLT
- VYBE
- NABIT
- PAR-T

### Equity Financial
The official bank name is **Equity Financial**.

### PAR-T
Transit:
- Bus
- Light Rail
- Train

Tickets:
- Single Ride
- Round Trip
- Day Pass
- Weekly Pass
- Monthly Pass

Discounts:
- Student: 25% off
- Reduced / Accessibility: 50% off

## Currency

100 Voro = 1 Nova.

New characters begin with:

`N1,000.00`

Starter money begins as character cash and moves into Checking when the player opens an Equity Financial Checking account.

## Visual templates

The image files in `/assets` are meant to be reusable templates. Dynamic information should be drawn on top of the image by the bot rather than generating a new AI image for every transaction/order/ride.

## First deployment checklist

1. Supabase complete SQL shows SUCCESS.
2. Push this folder to GitHub.
3. Connect the GitHub repo to Render.
4. Add the four secret environment variables in Render.
5. Deploy.
6. Check Render logs for:
   - command registration
   - health server ready
   - John logged in
7. Test `/character`.
8. Test `/bank`.
9. Test `/apps` → PAR-T.
