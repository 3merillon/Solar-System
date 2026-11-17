# The score

Started 17 November 2026 on the development branch. Brief: `docs/NEXT-CONTEXT-MUSIC.txt` (development repository only),
redirected by the owner on the day toward the owner's Relative Music Theory, and reworked the same day, at the
owner's word, onto classical harmony (below: "Why the harmony was rewritten").

The page's music is composed while it plays. Nothing is recorded, sampled or downloaded. Where the player is
decides what is played; a session never hears the pieces of another session; a place visited twice gets a new
piece each time.

Every pitch in it is an exact fraction of one note. No note is tempered. The harmony is the tonal harmony of
Bach, Mozart, Chopin, Liszt and Rachmaninov, with a look toward Scriabin, written in pure intervals.

## Relative Music Theory, and what is taken from it

Relative Music Theory is the owner's (the editor RMT Compose at rmt.world,
repository `rmt-compose-poc`). Its idea: a note is not a pitch but a relationship. Its frequency, start and
length are expressions of another note's (`[1].f * (3/2)`, `[1].t + [1].d`), down to one BaseNote that is
whatever you say it is. A group of notes hung from one note is a module, and a module can be hung from any note.

The score takes that literally:

- **One BaseNote**: the Sun, 263/8 Hz (263 Hz is the base the owner's own modules start from; three octaves down).
- **Everything is a fraction of something else.** A place is a fraction of another place (next section). A key is
  a fraction of the place (1 at home, 3/2 in the dominant, 8/5 a major third below). A chord's root is a fraction
  of its key's tonic (the subdominant 4/3, the Neapolitan 16/15). A note is a fraction of its chord's root. Starts
  and lengths are fractions of the beat.
- **Fractions stay exact.** `web/music-theory.js` keeps them on BigInt (`Q`): 81/80 multiplied four hundred
  times and divided four hundred times is exactly 1. A number in hertz exists only at the moment a note is
  handed to an oscillator.
- **Any stretch of any piece can be written out as an RMT module** (`tools/Export-Music-RMT.mjs`, or
  `solarMusic.module()` on the page) and opened in RMT Compose: it is a transcription, not a conversion.

The theory allows any relationship at all, the ugly ones included. What follows is this project's choice of
relationships, not the theory.

## The notes of the bodies

A body's note is a fraction of its parent's: how many times it goes round while its parent goes round once (the
ratio of orbital frequencies), as the nearest simple fraction to the measured ratio of periods. "Simple" means
prime limit 13 and the smallest numerator times denominator within 0.6% (10 cents); Ganymede is given the 2:1 of
the Laplace relation although the pair's own ratio is 0.7% off. Earth hangs from the Sun by the Sun's rotation.
Octaves cost nothing here: the note that sounds is the fraction folded into the octave above the BaseNote.
The periods are the usual fact-sheet values (NASA's planetary and satellite fact sheets), typed in and not re-checked
against the sheets for this document; no fraction depends on their last digits.

| Body | Period (days) | Of | Measured ratio | Fraction | Error | Sounds at (of the Sun) | Hz |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sun | 25.38 (rotation) | | | 1 | | 1 | 32.88 |
| Earth | 365.256 | Sun | 0.069486 | 5/72 | -0.06% | 10/9 | 36.53 |
| Mercury | 87.969 | Earth | 4.1521 | 25/6 | +0.35% | 125/108 | 38.05 |
| Venus | 224.701 | Earth | 1.6255 | 13/8 | -0.03% | 65/36 | 59.36 |
| Mars | 686.98 | Earth | 0.53168 | 8/15 | +0.31% | 32/27 | 38.96 |
| Jupiter | 4332.59 | Earth | 0.084304 | 27/320 | +0.08% | 3/2 | 49.31 |
| Saturn | 10759.22 | Earth | 0.033948 | 3/88 | +0.42% | 40/33 | 39.85 |
| Uranus | 30685.4 | Earth | 0.011903 | 1/84 | +0.01% | 320/189 | 55.66 |
| Neptune | 60189 | Earth | 0.0060685 | 7/1152 | +0.13% | 140/81 | 56.82 |
| Pluto | 90560 | Neptune | 0.66463 | 2/3 | +0.31% | 280/243 | 37.88 |
| Moon | 27.3217 | Earth | 13.369 | 40/3 | -0.26% | 50/27 | 60.88 |
| Phobos | 0.31891 | Mars | 2154.2 | 10752/5 | -0.17% | 56/45 | 40.91 |
| Deimos | 1.26244 | Phobos | 0.25261 | 16/63 | +0.54% | 512/405 | 41.56 |
| Io | 1.769138 | Jupiter | 2449.0 | 12288/5 | +0.35% | 9/5 | 59.18 |
| Europa | 3.551181 | Io | 0.49818 | 1/2 | +0.36% | 9/5 | 59.18 |
| Ganymede | 7.154553 | Europa | 0.49635 | 1/2 | +0.73% | 9/5 | 59.18 |
| Callisto | 16.689018 | Ganymede | 0.42870 | 3/7 | -0.03% | 54/35 | 50.72 |
| Titan | 15.945421 | Saturn | 674.8 | 672 | -0.41% | 35/22 | 52.30 |
| Rhea | 4.518212 | Titan | 3.5291 | 39/11 | +0.46% | 1365/968 | 46.36 |
| Dione | 2.736915 | Rhea | 1.6508 | 33/20 | -0.05% | 819/704 | 38.25 |
| Tethys | 1.887802 | Dione | 1.4498 | 13/9 | -0.37% | 1183/704 | 55.24 |
| Enceladus | 1.370218 | Dione | 1.9974 | 2 | +0.13% | 819/704 | 38.25 |
| Mimas | 0.942422 | Tethys | 2.0031 | 2 | -0.16% | 1183/704 | 55.24 |
| Iapetus | 79.3215 | Titan | 0.20102 | 1/5 | -0.51% | 14/11 | 41.84 |
| Titania | 8.705872 | Uranus | 3524.7 | 24576/7 | -0.39% | 640/441 | 47.71 |
| Oberon | 13.463239 | Titania | 0.64664 | 9/14 | -0.59% | 640/343 | 61.34 |
| Umbriel | 4.144177 | Titania | 2.1007 | 21/10 | -0.04% | 32/21 | 50.10 |
| Ariel | 2.520379 | Umbriel | 1.6443 | 18/11 | -0.48% | 96/77 | 40.99 |
| Miranda | 1.413479 | Ariel | 1.7831 | 16/9 | -0.30% | 256/231 | 36.43 |
| Triton | 5.876854 | Neptune | 10241.7 | 10240 | -0.02% | 175/162 | 35.51 |
| Charon | 6.38723 | Pluto | 14178.3 | 212992/15 | +0.15% | 1456/729 | 65.66 |

Other stars: a star's note is the Sun's times the ratio of their temperatures (the frequency at which a star
shines most is proportional to its temperature), as the nearest simple fraction within 1.2%. Their worlds are
invented by the game, so their notes are invented too: steps of the pure major scale over their star.

This is a mapping chosen for the music. The period ratios are real and the errors are listed; that the planets
"sound" these notes is not a physical claim. The idea of hearing orbits as intervals is Kepler's (Harmonices
Mundi, 1619) and has been done many times since.

## The harmonic language

`web/music-harmony.js`. Tonal harmony on a lattice of pure intervals. Simple relationships come first:

| Prime | Interval | What it carries |
| --- | --- | --- |
| 3 | The fifth 3/2, and the fourth 4/3 | The functions: tonic, dominant, subdominant; the circle of fifths |
| 5 | The major third 5/4, the minor third 6/5 | The colour of a chord; the Romantic changes of key by a third |
| 7 | The harmonic seventh 7/4 | Only a clean dominant seventh whose root then falls a fifth |

Nothing above the seventh harmonic is used, except in one piece at the stars (Sunrise).

### Chords

A chord is a root, as a fraction of its key's tonic, and a quality, as fractions of the root.

| Major key | Root | Minor key | Root |
| --- | --- | --- | --- |
| I | 1 | i | 1 |
| ii | 10/9 | iv | 4/3 |
| iii | 5/4 | v, V | 3/2 |
| IV | 4/3 | III | 6/5 |
| V | 3/2 | VI | 8/5 |
| vi | 5/3 | VII | 9/5 (and 16/9 on the subdominant side) |
| Borrowed from the minor: i, iv, v, bIII 6/5, bVI 8/5, bVII 16/9 | | Borrowed from the major: I, IV | |
| Neapolitan | 16/15 | Neapolitan | 16/15 |
| Augmented sixth | 8/5 | Augmented sixth | 8/5 |
| Dominant of another chord (V of V, V of vi ...) | a pure fifth above that chord's root | the same | |

| Quality | Fractions of the root |
| --- | --- |
| Major, minor triad | 1 5/4 3/2 (4:5:6); 1 6/5 3/2 (10:12:15) |
| Dominant seventh, ninth | 1 5/4 3/2 7/4 (9/4): the harmonics 4:5:6:7:9. Or with the seventh two fifths down: 1 5/4 3/2 16/9 (9/4) |
| Major seventh, added sixth, added ninth | 15/8, 5/3, 9/4 over the major triad |
| Minor seventh, sixth, ninth | 9/5, 5/3, 9/4 over the minor triad |
| Suspended | 1 4/3 3/2; 1 9/8 3/2 |
| Fifths | 1 3/2 9/4: three notes a pure fifth apart, prime 3 alone |
| Augmented sixth | 1 5/4 3/2 225/128 |

- **Which seventh** (the owner's rule). The harmonic seventh 7/4 belongs to a clean chord about to resolve: its
  bass is one of its own tones (no pedal under it) and the next different root lies a fifth below. There it melts
  into the resolution. Anywhere else (over a tonic pedal, before a deceptive close, left hanging) the seventh is
  two fifths down, 16/9: over a dominant that is exactly the key's own fourth step, a pure fourth above the tonic.
  The composer writes `V:7` and the rule decides after the progression is known.
- **The augmented sixth** has its top tone at 225/128: the leading tone of the dominant, a 16/15 below it. It lies
  225/224 (7.7 cents) above the harmonic seventh, which is why the German sixth and a dominant seventh can be taken
  for each other; the score uses each where it resolves as itself.
- **Where the commas are.** Pure chords cannot all share one scale. The supertonic of a major key stands on 10/9
  so that it is pure with the subdominant; the second step under the dominant is 9/8. The fourth step is 4/3; the
  harmonic seventh of the dominant is 21/16. The sixth step is 5/3; the ninth of the dominant is 27/16. Each pair
  is 81/80 or 64/63 apart. The rule: **two tones a comma apart never sound together.** A held tone whose near
  neighbour belongs to the next chord is ended before that chord sounds, and a doubling that would land a comma
  from a chord tone is left out. The check below counts it.
- **A melody's scale** under a chord is the key's scale with every step that is a chord tone moved to exactly
  where the chord has it. Over a borrowed chord it is the other mode's scale; over the dominant of a minor key
  the sixth and seventh steps rise (the sixth to the pure ninth of that dominant).

### Phrases and cadences

Chords come in cells of four, written the way a harmony book writes them (`I vi ii V:7`, `N/3 I/5 V:7 I`,
`i v/3 iv/3 V`), each marked with whose manner it is: Bach, the Classical style, the Romantics, or late (toward
Scriabin: sevenths and ninths as colours, stacked fifths). A phrase is two cells: one that opens, one that closes
on a cadence (half, full, deceptive, plagal). A cell is fitted to what came before it: a dominant is answered by a
tonic, and a bass that can go on by step is preferred, which is where the falling basses come from.

A piece is: a phrase at home that stops on the dominant; the same opening answered, ending in a new key; one or
two phrases in each other key; the opening again at home with a full close; a coda on the tonic. Some pieces
have their own form instead (a ground with variations, a cradle song over one bass note).

### Changes of key

A modulation multiplies the tonic by a fraction and is made through a door: a chord that is exactly a chord of
both keys, or a tone that is exactly the same pitch in both.

| New tonic, of the old | Between | Door |
| --- | --- | --- |
| 3/2 | major to its dominant | vi of the old key is ii of the new (both on 5/3 of the old tonic) |
| 4/3 | major to its subdominant | the old tonic chord is the new dominant |
| 5/3, 6/5 | a major key and its relative minor | ii and IV of the major are iv and VI of the minor |
| 5/4 minor | major to its mediant | vi is iv of the new key |
| 1 | major and minor on the same tonic | the dominant is shared |
| 5/4, 8/5 major | a major third up or down | the tone the two tonic chords share (the old third becomes the new root, or the old root the new third); back up by the old tonic chord with an augmented sixth added |
| 6/5, 5/3 major | a minor third up or down | by way of the minor on the same tonic, or the one shared tone |
| 8/5 from a minor key | to its sixth degree | the old tonic is iii of the new key; the old Neapolitan is its IV |
| 16/15 | up a semitone | the old augmented sixth chord, read as a dominant (three tones held, the fourth 7.7 cents lower) |
| 15/16 | down a semitone | the old dominant, with an augmented sixth added |
| 9/8, 16/9, 10/9, 9/5 | by a tone (sequences) | IV of the new key is V of the old; and so on |
| 3/2, 4/3 minor | minor to minor by a fifth | iv of the new key is the old tonic |

Twenty-six such changes are in the table, with one to four ways of making each. **Every plan of keys is a closed
walk on the lattice**: the fifths add up to nothing and the thirds add up to nothing, so the piece comes home to
the very pitch it left. (Three major thirds fall short of an octave by 128/125; a walk that wandered would drift.
The first version of this score did, on purpose.) Where the key changes by a shared tone, that tone is sounded
alone from before the change until after it (the thread).

### Staying in a key

Not every piece travels. Inside a key there is: the tonic held in the bass while the chords above it change
(`I IV/T V:7/T I`); chords borrowed from the other mode (iv, bVI, bVII); dominants of other chords; the
Neapolitan; and, as the place for something of this score's own, **prime 3 on its own**: chords of stacked pure
fifths (1 : 3/2 : 9/4 on the tonic, the subdominant and the dominant, which together are a pentatonic scale of
fifths), and the tune doubled a twelfth above (3/1, its own third harmonic, as an organ's quint stop does) where
that tone is pure with the chord. Vigil is the piece built on these.

### The tune

A phrase has a skeleton: one tone of each chord, chosen so that the line moves by small steps along an arch and
lands where its cadence asks (the tonic at a full close, a tone of the dominant at a half close). Several are
drawn and the smoothest kept. Between those tones the surface is a rhythm (a motif of the piece) filled with
passing and neighbour notes; each next skeleton tone is approached by step; no note is said twice running; a note
of two beats or more off the beat is a chord tone; an appoggiatura may lean on a beat for half a bar at most and
falls by step. Phrases with the same theme begin alike, so the opening comes back note for note when the theme
returns.

### Few things at once

A piece is a bass, one accompaniment figure and one tune, at most with a quiet bed of held chords. The figure's
chord is spaced as the harmonic series spaces it: nothing closer to the bass than a fifth, thirds higher up.
There is no echo; rooms are the only tail.

### Why the harmony was rewritten

The first version of this score (the same night) drew each section's scale from a table of pure alternatives up to
the thirteenth harmonic, let roots move by any kept tone, walked comma paths, and stacked up to eight layers. The
owner's verdict: too much dissonance, scales that are close but unrelated, too much going on; some sounds worth
keeping. Measured afterwards in the same way as the present score (table in Checks), its pieces had two tones a
comma apart sounding together in 9% of all instants, and up to 25 notes at once. The sound world was kept (voices,
rooms, the notes of the bodies, how places change the music); what the notes are was replaced.

None of this harmony is new, and no novelty is claimed. Just intonation of tonal harmony goes back to Zarlino;
the comma between ii and V is in Helmholtz and Ellis; choosing the tuning of a tone by its chord is what choirs,
string quartets and barbershop singers do and what Hermode tuning and Sethares's adaptive tuning do by machine;
the harmonic seventh as a dominant seventh is barbershop practice and Fokker's and Vogel's theory; that an
augmented sixth is nearly a harmonic seventh (225/224) is textbook. Changes of key by a shared tone are Schubert's
and Liszt's, described by Riemann and by Lewin and Cohn; phrases, periods and cadences are Koch's and Schoenberg's
terms, Caplin's in detail; composing tonal music by rule has been done since Ebcioğlu's chorales and Cope's
experiments. Hearing orbits as intervals is Kepler's. Reading Scriabin's chord as the upper harmonics is
Sabaneyev's, and disputed. What is particular here is that it is written in the owner's notation of relationships
and composed while a solar system is flown through.

## What plays where

Twelve pieces, each a way of being few things at once (it draws tempo, key, harmony, tune and instruments from
the seed), not a song:

| Piece | What it is |
| --- | --- |
| Chorale | Four parts moving chord by chord, as in a Bach chorale: sung, bowed, or on an organ with its twelfth drawn |
| Prelude | One broken-chord figure, chord after chord; a slow upper line joins later |
| Aria | A singing line over a murmuring bass, in clear periods |
| Nocturne | Wide broken chords in the left hand; a tune that leans and resolves; keys a third away |
| Berceuse | The bass never leaves the tonic; the harmony rocks between rest and leaning; the line grows finer at each return |
| Consolation | A harp of fifths and tenths, a long tune with its twelfth for a halo, keys a third apart joined by the tone they share |
| Elegy | The minor: low strings, a tune in the middle, a bell where each phrase begins |
| Étude | For speed: a figure that does not stop, harmony moving by fifths |
| Passacaglia | Variations on a ground of eight chords, once in the other mode |
| Vigil | The tonic underneath for a long time, chords turning slowly above it, far bells; stays in its key and looks around |
| Sunrise | One deep note and its harmonic series, partial by partial; the root moves by a fifth or a third; at a star, the crest takes partials 7, 9, 11 and 13 |
| Orrery | Bells struck once per orbit at the real period ratios of a planet's moons; their pitches are five tones of the key that are pure with one another |

| Place | Pieces (heavier first) | Leaning |
| --- | --- | --- |
| The Sun, other stars | Sunrise, Chorale, Vigil, Orrery (at the Sun, the planets), Consolation | Major; a hotter star brighter, a cooler one darker |
| Giants | Orrery (their moons), Passacaglia, Chorale, Vigil, Elegy, Prelude | Even |
| Icy moons, Pluto | Consolation, Prelude, Nocturne, Berceuse, Vigil | Rather major, bright sound |
| Rocky airless worlds | Elegy, Passacaglia, Nocturne, Prelude, Vigil, Chorale | Rather minor |
| Io, Venus | Elegy, Passacaglia, Chorale, Prelude, Étude | Minor, dark sound |
| Mars, Titan | Nocturne, Aria, Berceuse, Prelude, Consolation, Étude | Even |
| Earth | Nocturne, Aria, Prelude, Berceuse, Consolation, Chorale, Elegy, Passacaglia, Étude, Orrery (Moon, Sun, year) | Major |
| Deep space | Vigil, Prelude, Chorale, Orrery (the planets), Nocturne, Consolation, Étude | Even; silences |
| Among Saturn's rings (0.15 to 1.3 radii above the cloud tops) | Orrery, Consolation, Berceuse, Prelude | Major, bright sound |
| Inside the asteroid belt (where the page draws its field of rocks) | Vigil, Elegy, Prelude, Passacaglia | Rather minor; silences |
| Another star's system | Consolation, Vigil, Sunrise, Nocturne, Elegy, Prelude | Even |

`web/music-director.js`:

- **A body takes over** inside 6 of its radii once that has held for 4 seconds, and lets go beyond 10 radii.
  A skim past a moon changes nothing.
- **Two pieces sound together only if their keys go together**: the tonics the same, a fifth or a third apart,
  and no two tones of the two tonic chords nearer than a semitone (the same key; a key and its dominant; a key and
  its relative: the Moon's note is 5/3 of Earth's, so Earth in the major and the Moon in the minor cross over).
  Then the new piece enters on the old one's bar line and the two cross at equal power over 5 to 12 seconds.
  Otherwise the old piece is let go first and the new one begins when it has mostly gone: the notes of two bodies
  are whatever their orbits make them, and two unrelated keys at once is what the first version sounded like.
- **A piece lasts 2 to 5 minutes**, then the next comes from the same family; every piece of a family comes round
  before one repeats. In deep space a piece may fade to near silence for 10 to 20 seconds before the next.
- **The Étude** is for speed: likely when the craft is fast or low, rare otherwise.
- **A Go trip** sounds a five-second rise as it starts; the arrival sounds a low gong with the new place's note in
  open fifths (right for a major or a minor piece), and the new piece comes in at once. The hyperdrive does the
  same in a second and a half. A place flown into without a trip is announced by its own note, held through the
  change of piece.
- **The clock running backward** turns the music over: major becomes minor, minor major, and the tune is played
  upside down. A paused clock changes nothing.
- **Never the same.** The seed is a hash of a salt drawn when the page opens, the place, the visit and the
  piece; tunes already heard in the session are refused.

The Soundtrack group at the top of the panel says what is playing: the place and its note as a fraction of the Sun's, then
the piece, its mode, the keys it goes through as fractions of its own tonic (`keys 1 → 5/4m → 1`), and its
tempo. Play / Pause and the volume are as before.

## How it is made

| File | What it holds |
| --- | --- |
| `web/music-theory.js` | Exact fractions (`Q`), seeded random numbers |
| `web/music-harmony.js` | Chords, cells, modulations, walks of keys, the harmony of a whole piece; harmonic distance and roughness |
| `web/music-composer.js` | `makeTheme(spec)` (a piece from a seed: its harmony and its tune) and `composeBar(theme, bar, energy)` (its notes). Pure: no Web Audio, no clock |
| `web/music-director.js` | The notes of the bodies, the orreries, pieces by place, when to change piece and how. Pure |
| `web/music-synth.js` | Voices, rooms, the rack of effects of one deck, the master limiter |
| `web/music-engine.js` | Decks, the scheduler, the voice budget, crossfades, the offline render |
| `web/music-rmt.js` | A stretch of a piece as an RMT module |
| `web/celestial-music.js` | The part that touches the page: the context, gestures, hidden tabs, reading the flight |
| `web/music-lab.html` | A bare page for offline renders (not part of the published site) |

The eight modules are 138 KB of commented source, loaded with the page; the audio context is only made on the
first gesture.

- **Composer and engine are apart.** A piece's harmony and tune are made when the piece is made (about a
  millisecond); its notes are then a pure function of the bar, the same in whatever order bars are asked for. The
  engine composes a bar when the audio clock comes within half a second of it and schedules notes on that clock.
- **Voices in use**: choir (a buzz through the formants of a sung vowel), bowed glass, pad, strings, pure
  partials, bells by frequency modulation (the modulator at a whole multiple of the note, so a bell's partials are
  harmonics and sit inside a pure chord), felt piano, pluck, a sine bass with its second and third harmonics, and
  for the figures of a trip the endless glissando, wind, and a gong of inharmonic partials. The synthesizer also
  still has the drums, the lead, struck metal, the cloud of grains and the echo of the first version; no piece uses
  them now.
- **Effects per deck**: chorus, a level set from measurement so pieces match in loudness, and a send into a room.
  A dry path always.
- **Rooms**: four convolution reverbs (impulse responses of 1.5 to 3 seconds, computed once in slices of about
  a millisecond and kept). Each has one convolver for the whole engine, made the first time it is wanted in a
  turn of its own, and every deck that uses the room sends into it through a gain that moves with the deck's
  fader. (Each deck had its own at first; giving a convolver its impulse response costs about 10 ms of main
  thread, which made every change of piece a long task.)
- **Purity in the instruments.** Unison detune is 3 cents, chorus wobble under 3, vibrato 3 to 4: a pure chord
  has to be heard as pure.
- **Master**: volume, a limiter with its make-up gain taken back out, and a ceiling curve that cannot pass
  full scale.
- **Budget**: 60 voice units (28 in the light profile), a unit being about an oscillator and a half. A note that
  would exceed it is dropped unless it is the ground (bass, held chords), which may run over by a third; ornaments
  go first. A piece on its way out stops its ornaments at once. The figures of a trip have 28 units of their own
  (14 in the light profile): enough for the rise still ringing and the whole arrival.
- **One timer**, every 100 ms. It does nothing unless the context is running, so a suspended, interrupted or
  closed context cannot spin. A late timer looks further ahead from then on; a very late one slides the decks
  forward so the music resumes where it was. Finished voices are let go by one sweep; there is no timer or
  callback per note.
- **Hidden tab**: fade, stop the timer, suspend the context. Shown: resume. Phones: any of pointerdown,
  pointerup, touchend, click or keydown starts or resumes the context.
- **Light profile** (a coarse pointer, or four cores or fewer): 28 units, and less to play rather than more
  dropped: three-tone chords, every other note of the sixteenth-note figures, no twelfth doubling, two oscillators
  where the full profile has three, no chorus, no shimmer, no vibrato oscillators, three formants.

## Checks

### The composer, the harmony and the director (no sound)

`node tools/Test-Music.mjs` runs them in Node: 118 checks, all passing. What they establish, in the tool's own words (`--verbose` prints them):

- **Fractions and chords**
  - 81/80 to the 400th and back is exactly 1.
  - A 764-digit fraction still gives the right number.
  - Twelve fifths overshoot seven octaves by the Pythagorean comma, exactly.
  - Three major thirds fall short of the octave by 128/125: why a walk of keys is closed by plan and not by luck.
  - vi of a major key is exactly ii of its dominant key (both stand on 5/3).
  - ii and IV of a major key are exactly iv and VI of its relative minor.
  - A dominant seventh is the harmonics 4:5:6:7 of its root, or has its seventh two fifths down (16/9).
  - The seventh two fifths down over the dominant is exactly the fourth step of the key.
  - The augmented sixth is the leading tone of the dominant (a 16/15 below it); it lies 225/224 above the harmonic seventh.
  - The German sixth of a key and the dominant seventh of the key a semitone above hold three tones in common exactly.
  - 736 chord symbols in the cells and the modulations: all exist in their key; nothing above the seventh harmonic, and that only in dominant sevenths and ninths.
  - 49 of 49 modulations enter the new key by a chord of the old key or by a tone held exactly.
  - 400 of 400 walks through one to three other keys come home exactly (26 kinds of key change used).
- **Every piece, twelve seeds each** (58 checks): no unplayable note and none starting outside its bar; every pitch is the BaseNote times its fraction; the same seed and bar give the same notes in whatever order bars are asked for; pitches stay between 20 and 9000 Hz; twelve salts give twelve different tunes.
- **Harmony: keys, cadences, doors**
  - 120 of 120 pieces end on the tonic chord of the key they began in, on exactly the same pitch.
  - 7540 chords: every one a pure chord of the table (primes 3 and 5; 7 only in dominant sevenths and ninths).
  - 1108 dominant sevenths: 598 harmonic (4:5:6:7), every one a clean chord whose root then falls a fifth; 510 with the seventh two fifths down (over a pedal, or not resolving).
  - 255 of 255 changes of key are made through a chord of the key being left (238) or a tone held exactly (223).
  - 104 of 120 pieces leave their key; 21 different other keys visited: 1 10/9m 15/8 15/8m 16/15 16/9 16/9m 1m 3/2 3/2m 4/3 4/3m 5/3 5/3m 5/4 5/4m 6/5 8/5 9/5 9/8 9/8m.
  - 141 of 141 full closes land on a tonic.
- **What sounds together: no commas, no mud**
  - 36399 instants heard: 0 with two tones a comma apart.
  - No two long tones closer than a minor third sound together below 180 Hz (20126 low tones checked).
  - Every mood stays smooth: the roughest 95th percentile is 0.234 (limit 0.25).
  - Few things at once: at most 10 notes sounding in the median instant of any mood (limit 10).
  - The roughness measure calls a low close triad several times rougher than the same triad two octaves up.
- **The tune**
  - 5330 of 5669 notes on a strong beat are tones of the chord, 339 more lean on it and resolve by step.
  - No leap wider than an octave in 10840 moves; 55% are steps, 5% repeat a note.
  - No tune moves by a comma (the same step of the scale as two chords tune it): 0 of 10840 moves.
  - A note is seldom said twice running (594 of 10840).
  - 114 of 127 full closes end the tune on the tonic itself.
  - 90 of 90 pieces bring their opening back note for note when the theme returns.
- **Written out as RMT modules**
  - 36 modules, 2410 notes: every composed pitch is in its module, as the same exact fraction.
  - Every note starts where the composer put it, to 1/96 of a beat (0 do not).
  - Every expression refers only to notes written before it.
  - 2374 of 2410 frequencies are written as fractions of another note, not of the BaseNote.
- **Director**
  - Jupiter's note folds to 3/2 of the Sun's (3/512).
  - Io, Europa, Ganymede are octaves (4:2:1).
  - Pluto is 2/3 of Neptune.
  - Uranus is 1/84 of Earth.
  - Starts in deep space with one piece.
  - A body inside its range does not take over before it has held for four seconds.
  - It takes over after the dwell.
  - A place flown into is announced by its own note.
  - Between 6 and 10 radii the body keeps the music (hysteresis).
  - A brief excursion beyond 10 radii changes nothing.
  - Beyond 10 radii, held, deep space returns.
  - A Go trip starts with the riser.
  - No change of piece during the trip.
  - Arrival: the stinger and the new place at once.
  - The clock running backward turns the piece over.
  - Turned over: major for minor, the tune upside down.
  - A piece that reaches its end is followed by another.
  - next() asks for another piece in the same place.
  - Zones in turn: space:10, belt:10, space:10, body:699, rings:699, rings:699, body:699.
  - Another session, another piece in the same place.
  - Forty pieces at Earth: 10 moods, never the same twice running.
  - Changes of piece: 31 crossfaded (keys that go together), 28 with the old piece let go first (keys that do not).
  - The figures of a trip and of a place coming into range compose.
  - Deep space, 40 sessions: 16 pieces ended in a silence, and all 16 were followed by a new piece 10 to 20 s later.
- **Every place: five pieces each, composed without a fault**
  - 36 places, 180 pieces in 12 moods: no fault, no unplayable note.
  - 175 different lines for the panel among 180 pieces.
- **Cost of composing** (this machine, Node): a new piece 0.06 to 1.76 ms (its whole harmony and tune), then 0.005 to 0.019 ms a bar, the worst bar 0.73 ms.

### The first version and this one, measured alike

Every half second of every piece of each version (eight seeds a piece, three places; the first version from the commit before the rewrite): the notes sounding until their written end. A comma is two of them 4 to 60 cents apart with octaves folded away. Roughness is Sethares's fit of Plomp and Levelt's curve over what is sounding, four harmonics a note; for it and for the count a note rings on for a third of its release. This is arithmetic on the composed notes, not on the sound: rooms and release tails are outside it, and it is not a judgment of beauty.

| | Instants with a comma sounding | Roughness, median / 95th percentile | Notes sounding at once, median / 95th percentile | Notes begun per second |
| --- | --- | --- | --- | --- |
| **First version, all 14 moods** (30060 instants) | **9.08%** | 0.097 / 0.317 | 7 / 18 | 2.7 |
| monolith | 0% | 0.216 / 0.361 | 18 / 25 | 1.3 |
| sunrise | 4.9% | 0.157 / 0.247 | 13 / 20 | 1.1 |
| lux | 0.6% | 0.051 / 0.117 | 4 / 6 | 0.6 |
| stargate | 0% | 0.132 / 0.25 | 11 / 15 | 0.9 |
| orrery | 0% | 0.038 / 0.09 | 7 / 11 | 1.6 |
| canon | 7.9% | 0.067 / 0.176 | 4 / 6 | 1.5 |
| mandala | 20% | 0.089 / 0.165 | 9 / 13 | 4 |
| drift | 0.1% | 0.124 / 0.222 | 7 / 10 | 0.5 |
| aurora | 7.6% | 0.05 / 0.136 | 8 / 13 | 1.8 |
| dreamy | 11.6% | 0.091 / 0.198 | 7 / 11 | 2.8 |
| elegy | 13.2% | 0.099 / 0.171 | 7 / 10 | 2.3 |
| voyage | 10.8% | 0.105 / 0.236 | 7 / 11 | 6.1 |
| pulse | 0.4% | 0.092 / 0.165 | 6 / 9 | 12.4 |
| abyss | 48.5% | 0.307 / 0.456 | 12 / 16 | 0.8 |
| **This version, all 12 pieces** (36399 instants) | **0%** | 0.094 / 0.2 | 6 / 13 | 3.2 |
| chorale | 0% | 0.09 / 0.234 | 6 / 11 | 2.3 |
| prelude | 0% | 0.134 / 0.225 | 10 / 14 | 5.1 |
| aria | 0% | 0.037 / 0.095 | 4 / 6 | 3.4 |
| nocturne | 0% | 0.131 / 0.227 | 8 / 12 | 3.8 |
| berceuse | 0% | 0.106 / 0.193 | 6 / 7 | 3.2 |
| consolation | 0% | 0.136 / 0.218 | 10 / 15 | 4.5 |
| elegy | 0% | 0.091 / 0.152 | 5 / 8 | 1.2 |
| etude | 0% | 0.082 / 0.16 | 9 / 12 | 9.9 |
| passacaglia | 0% | 0.087 / 0.201 | 6 / 11 | 2.4 |
| vigil | 0% | 0.081 / 0.159 | 6 / 9 | 0.8 |
| sunrise | 0% | 0.098 / 0.169 | 10 / 16 | 0.9 |
| orrery | 0% | 0.065 / 0.123 | 5 / 8 | 1.4 |

The notes begun per second did not fall: there is as much music. What fell is how much of it sounds at once, and what it is made of.

### Rendered offline

`node tools/Render-Music.mjs` renders through an OfflineAudioContext with the same composer, decks and voices as the page (48 kHz, volume at its default). Fifteen sketches of one and a half to three and a half minutes: each piece's whole form in about three phrases, a flight with two changes of piece, and a piece with its mirror:

| Sketch | Seconds | Peak | RMS | Most voice units in use (of 60) | Notes dropped | Energy below 150 Hz, to 800, to 4 kHz, above (dB) |
| --- | --- | --- | --- | --- | --- | --- |
| A-chorale-jupiter | 120 | -7.75 dB | -21.52 dB | 26 | 0 | -27.2, -27.2, -30.8, -40.9 |
| B-prelude-europa | 131 | -6.54 dB | -21.5 dB | 29 | 0 | -27.3, -27.5, -29.5, -39 |
| C-aria-earth | 115 | -6.63 dB | -21.53 dB | 21.5 | 0 | -27.1, -27.7, -29.2, -37.6 |
| D-nocturne-earth | 142 | -7.77 dB | -21.75 dB | 36.5 | 0 | -26.9, -27.6, -31.2, -42.2 |
| E-nocturne-moon | 170 | -8.12 dB | -21.31 dB | 33.5 | 0 | -26.2, -27.1, -30.4, -41.2 |
| F-berceuse-titan | 99 | -8.92 dB | -21.5 dB | 21.5 | 0 | -26.8, -27.7, -29.1, -39.2 |
| G-consolation-enceladus | 152 | -6.5 dB | -21.49 dB | 39.5 | 0 | -27.3, -27.5, -29.3, -39.6 |
| H-elegy-mercury | 152 | -6.21 dB | -21.48 dB | 22 | 0 | -26.7, -26.7, -31, -42.9 |
| I-etude-earth | 110 | -6.59 dB | -21.52 dB | 27.5 | 0 | -25.9, -27.7, -30.3, -40.2 |
| J-passacaglia-saturn | 133 | -6.37 dB | -21.53 dB | 30 | 0 | -26.9, -26.7, -31.3, -43.2 |
| K-vigil-deep-space | 200 | -6.45 dB | -21.5 dB | 29.5 | 0 | -26.7, -27.7, -31.4, -42.5 |
| L-sunrise-sun | 145 | -7.94 dB | -21.5 dB | 28.5 | 0 | -24.5, -29.5, -34, -45.2 |
| M-orrery-jupiter | 98 | -6.5 dB | -22.59 dB | 23.5 | 0 | -26.8, -30.2, -36.7, -48.8 |
| N-flight | 172 | -6.18 dB | -21.74 dB | 25.5 | 0 | -26.6, -27.3, -31.6, -42.5 |
| O-mirror | 164 | -7.28 dB | -21.98 dB | 21.5 | 0 | -27, -27.7, -30.7, -40.3 |

No sample is NaN or infinite (0 found); the highest peak is 6.2 dB below full scale; RMS lies between -22.59 and -21.31 dB; 0 notes were dropped by the budget. Levels were set by rendering each layer of each piece alone (`--stems`), then each piece's level was set from a table like this one toward -21.5 dB.

Full and light profiles, 45 seconds of each of seven pieces at high energy. The render share is the time one core of this machine took, as a share of the sound's length: a rough guide to the audio thread's load, not a measurement on a phone.

| Piece | Full: voice units, notes dropped, render share | Light: voice units, notes dropped, render share |
| --- | --- | --- |
| chorale | 27, 0 of 135, 8.3% | 18.5, 0 of 112, 7.4% |
| prelude | 15, 0 of 211, 7.5% | 9, 0 of 111, 5.2% |
| nocturne | 20, 0 of 159, 9.0% | 18, 0 of 159, 8.6% |
| consolation | 21.5, 0 of 163, 6.9% | 15.5, 0 of 147, 6.1% |
| etude | 30.5, 0 of 507, 16.3% | 22, 0 of 351, 11.5% |
| passacaglia | 25.5, 0 of 62, 5.1% | 24, 0 of 62, 4.1% |
| sunrise | 13.5, 0 of 18, 4.1% | 10, 0 of 17, 3.7% |

### On the page

`node tools/Test-Music-Live.mjs` on a served snapshot, private headless Chromium, 1920x1080, quality high, one page load per scene, the music off, on, on, off for 10 seconds each (the order cancels a drift over the run):

| Scene | Music | rAF interval p50 / p95 / p99 (ms) | GPU span p50 / p95 (ms) | Music on the main thread (ms per second) | Voice units | Late, retimed, stalls, dropped |
| --- | --- | --- | --- | --- | --- | --- |
| earth-hover | off | 8.4 / 33.4 / 41.8 | 41.9 / 43.99 |  |  |  |
| earth-hover | on | 8.4 / 41.6 / 41.8 | 41.81 / 44 | 0.65 (scheduler 0.53, director 0.12; worst tick 1.4) | 24 | 0, 0, 0, 0 |
| earth-hover | on | 8.4 / 41.7 / 41.8 | 41.81 / 43.43 | 0.68 (scheduler 0.6, director 0.08; worst tick 1.4) | 24 | 0, 0, 0, 0 |
| earth-hover | off | 8.4 / 41.6 / 41.8 | 41.81 / 43.41 |  |  |  |
| sun-2r | off | 8.3 / 8.4 / 8.4 | 2.99 / 3.03 |  |  |  |
| sun-2r | on | 8.3 / 8.4 / 8.4 | 2.66 / 2.68 | 0.49 (scheduler 0.38, director 0.11; worst tick 0.9) | 19.5 | 0, 0, 0, 0 |
| sun-2r | on | 8.3 / 8.4 / 8.4 | 3.01 / 3.03 | 0.33 (scheduler 0.23, director 0.1; worst tick 0.9) | 19.5 | 0, 0, 0, 0 |
| sun-2r | off | 8.3 / 8.4 / 8.5 | 3 / 3.04 |  |  |  |

- earth-hover, means of the two phases each way: GPU span p50 41.86 ms off, 41.81 ms on; rAF p95 37.5 off, 41.65 on; p99 41.8 off, 41.8 on; frames over 33 ms 58.5 off, 60 on.
- sun-2r, means of the two phases each way: GPU span p50 3 ms off, 2.83 ms on; rAF p95 8.4 off, 8.4 on; p99 8.45 off, 8.4 on; frames over 33 ms 0 off, 0 on.
- earth-hover: the two phases without music differ from each other (rAF p95 33.4 and 41.6 ms): the scene itself drifted during the run; the phases with music (41.6 and 41.7 ms) sit with the later one.

Nothing of the music runs on the render path, and the audio is rendered on the browser's own audio thread. In the Sun scene the GPU span's median moves by a few tenths of a millisecond from one phase to the next with the music on or off alike (here 2.99 off, 2.66 on, 3.01 on, 3 off); the first version's runs showed the same, between about 2.9 and 3.25 ms.

A change of piece, on the main thread (4 changes at the end of this run): choosing it (its whole harmony and tune are made then) took 1.5 to 3.6 ms, starting its deck 0.7 to 1.6 ms.

Behaviour, same run:

- Passed: hidden tab: scheduler stopped, context suspended, no ticks in the next 1.2 s
- Passed: shown again: running, 8 voices, bar 2 (was 1), 0 stalls
- Passed: context suspended from outside: scheduler stopped (state suspended), no ticks in the next 1.2 s
- Passed: a gesture resumes it: 8 voices
- Passed: near Earth the zone is body:399
- Passed: Go to the Moon: rise at 0.3 s, arrival at 5.3 s, then Moon · 50/27 of the Sun · Prelude · major · keys 1 → 5/3m → 5/4m → 1 · 60 BPM
- Passed: 67 notes sounded, 0 dropped by the budget, 0 late, 0 retimed, 0 stalls, worst tick 0.90 ms

`tools/Test-Game-Input.mjs` on the same snapshot: 76 of 76 pass. The music listens for gestures to start, in the capture phase and passively; it takes no key and stops no default.

`tools/Check.ps1` (formatting, the workspace's tests, Clippy, the WASM checks, shader validation) passed on 17 November 2026 with this version of the score switched on: 143 tests passed, 0 failed. The score touches no Rust and no shader.

## Open

- **The composer cannot hear.** The owner listened to the first version and sent it back; this one was built
  to the owner's description and checked by measurement and by reading pieces as text scores. Whether it is
  beautiful is again the owner's to say.
- **Levels** were set from renders of each layer alone and of whole sketches; balance between tune and
  accompaniment is by measurement, not by ear.
- **Phones and tablets**: the light profile exists and renders (table above) but has not been measured on a
  device, and the interrupted state has only been imitated (a context suspended from outside), not met on iOS.
  On an iPhone the ring switch silences Web Audio; the page does not override that.
- **RMT Compose**: the modules follow the documented format and are checked by an evaluator written here; none
  has been opened in the editor itself yet.
- **A "Next piece" control** is not in the panel (adding a control is the owner's decision);
  `solarMusic.next()` does it from the console.
- **Saturn's rings** are recognised by height above the cloud tops only (the flight report has no latitude), so
  the band over the poles counts too.
- **Other stars' worlds** have invented notes (steps of the pure major scale over their star) and no orrery; the
  stars' notes come from temperature.
- **Long sessions** (hours) have not been soak-tested live; the Node checks compose every place's pieces and the
  engine sweeps finished voices and disposes of old decks, but memory over hours is unmeasured.
- **The mapping of speed, height and clock rate to energy** is a first guess and has not been tuned in play.
