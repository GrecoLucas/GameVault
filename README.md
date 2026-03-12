# 🎮 GameVault — Rafael & Lucas Dashboard

A private gaming dashboard for tracking, rating, and comparing game libraries.

## ⚡ Quick Setup

### 1. Supabase Setup
1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste & run `schema.sql`
3. Go to **Authentication → Users** → create two users:
   - `lucas@yourdomain.com` + password
   - `rafael@yourdomain.com` + password
4. Copy your **Project URL** and **anon/public API key** from **Settings → API**

### 2. Configure the App
Open `app.js` and update lines 8–9:
```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Also update the authorized emails on line 12:
```js
const AUTHORIZED_EMAILS = ['lucas@yourdomain.com', 'rafael@yourdomain.com'];
```

### 3. Add Your Full Game Library
Open `games.js` and paste all 148 games into the `jogos` array, following the existing structure. The two sample games show the exact format needed.

### 4. Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# From the game-dashboard folder
vercel --prod
```
Or drag the folder to [vercel.com/new](https://vercel.com/new) for a zero-config deploy.

---

## 📁 File Structure

```
game-dashboard/
├── index.html      # Main HTML — all pages (login, dashboard, stats, rankings)
├── styles.css      # Full styling — dark cyberpunk glassmorphism
├── app.js          # All application logic (auth, state, rendering, Supabase calls)
├── games.js        # Your local game library (JSON data)
├── schema.sql      # Supabase database schema
└── README.md       # This file
```

## 🗄️ Database Architecture

**Strategy**: The JSON is the source of truth for game metadata. Supabase only stores:
- `profiles` — user accounts (id + username)
- `rankings` — ratings linked by `game_key` (the `chave_nome` field)

This means **zero game metadata in the database** — images, titles, times, categories all come from `games.js` locally.

## ✨ Features

- 🔒 **Private Auth** — Only Rafael & Lucas can log in
- 🎮 **Game Library Grid** — Cards with cover art, playtimes, categories
- 🔍 **Real-time Search** — Filter by game name instantly
- 🏷️ **Category Filters** — Sidebar pill filters by game genre
- ⭐ **Rating System** — Score Graphics, Gameplay, Story & Fun (0–10)
- 🌍 **Community Score** — Average of both users' ratings shown on each card
- 📊 **Stats Page** — Total hours, top rated games, most played, category breakdown
- 🏆 **Rankings Table** — Full sortable leaderboard across all games
- 📱 **Fully Responsive** — Works on mobile and desktop

## 🎨 Design

- Dark mode cyberpunk aesthetic
- Glassmorphism panels
- Orbitron + Rajdhani + JetBrains Mono fonts
- Deep purple / neon cyan / slate color palette
- Smooth hover animations on all cards
- Staggered grid entry animations
