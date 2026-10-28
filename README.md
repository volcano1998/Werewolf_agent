# Werewolf

Play Werewolf against 6 AI players. Each has its own avatar, personality, voice and private notes. An automatic notetaker tracks claims, suspicions and votes so you can analyze the game afterwards. English and 中文.

```bash
cp .env.example .env     # paste your OpenRouter key
node --env-file=.env server.js
```
Open http://localhost:3200. Node 20.6+, no install step. A full game costs about 1-3 cents on the default brain.

## Features
- 7 players: 2 werewolves, a seer, a doctor, 3 villagers. Pick your name, avatar, village identity and (optionally) your secret role.
- The doctor has one healing potion for the whole game and sees each night's victim.
- Voting with the option to abstain.
- A moderator narrates each night ("close your eyes... open your eyes") with synthesized dramatic music and the browser's built-in voices (optional).
- Choose how smart the players are (Quick, Smart, Sharp, Genius), and let them study Werewolf strategy online once (about 2-3 cents).
- Notetaker: per-player claims, suspects and votes, vote table, automatic flags for contradictions, a live cost breakdown, your own notes, Markdown export, and an optional AI post-game analysis.
- The AI players only know what a real player would know. Their private thoughts are shown after the game. Games are saved to `games/` as JSON.

See `.env.example` for settings.
