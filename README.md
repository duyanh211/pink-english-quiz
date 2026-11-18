# Pink English – Word Chain add-on

This package updates the current Pink English static app and adds the Word Chain mini-game.

## Runtime files

- `index.html` – adds the Word Chain screen and navigation item.
- `app.js` – validates words, runs Solo Practice / Player vs Computer, and saves the game locally.
- `questions.json` – retained from Flexible Learning 2.1; Grammar, Vocabulary and Conversation content is unchanged.
- `words.json` – 20,000-entry offline word list plus a small set of Vietnamese glosses/examples for common words.

## Install on the existing GitHub Pages repository

1. Replace `index.html` and `app.js` with the copies in this package.
2. Keep the current `questions.json` (the included copy is unchanged from Flexible Learning 2.1) or replace it with this package's copy.
3. Add `words.json` to the repository root, next to `index.html`.
4. Also keep `CMUDICT-LICENSE.txt` and `WORDCHAIN-DICTIONARY-NOTES.txt` in the repository for attribution and source notes.
5. Commit and push the files to the `main` branch. GitHub Pages will publish the update.

## Word Chain rules

- One shared dictionary for all player levels. CEFR labels never restrict the player's word choices.
- Words must contain 2–24 ASCII English letters, exist in the bundled list, start with the previous word's last letter, and not have been used already in the current game.
- A word absent from the bundled list is reported as “not in the built-in list”; this does not prove it is not a valid English word.
- `Solo Practice` lets one player build a chain. `Player vs Computer` adds a bot with Easy / Medium / Hard strategies.
- Each accepted move is saved in `localStorage` on the current browser/device.

## Dictionary notes

The 20,000-entry word list is an offline game lexicon, not a complete dictionary. Headwords are selected from the CMU Pronouncing Dictionary and ranked using a word-frequency list. Common proper names and place names are filtered, but edge cases may remain. Some entries have Vietnamese meanings/examples; all accepted words can be played even if a gloss is not included.

CMUdict attribution and license are included in `CMUDICT-LICENSE.txt`. See `WORDCHAIN-DICTIONARY-NOTES.txt` for further notes.
