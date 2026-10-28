# Werewolf

Play Werewolf against 6 AI players, each with its own avatar, personality, voice and private notes. An automatic notetaker tracks claims, suspicions and votes so you can analyze the game.

```bash
cp .env.example .env     # paste your OpenRouter key
node --env-file=.env server.js
```
Open http://localhost:3200. Node 20.6+, no install step. A full game costs 1-3 cents on the default brain.

- 7 players: 2 werewolves, seer, doctor, 3 villagers. Your role is random and secret.
- Each AI sees only what its player would see. Their private thoughts are revealed after the game.
- Games are saved to `games/` as JSON. `PLAYER_MODEL` in `.env` changes the AI brain.
