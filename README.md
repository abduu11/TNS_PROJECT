# TNS DIC2 — Numérisation, Segmentation et Filtrage d'un Signal Vocal

Projet de Traitement Numérique du Signal

---

## Présentation

Application web Python/Flask en deux parties :

- **Partie 1** — Numérisation et segmentation vocale : enregistrement microphone, choix des paramètres (fréquence d'échantillonnage, codage), sauvegarde dans une base de données locale, détection automatique des silences.
- **Partie 2** — Analyse fréquentielle et filtrage : chargement d'un fichier audio, affichage du signal temporel et du spectre FFT via Chart.js, application d'un filtre rectangulaire (passe-bande ou coupe-bande), reconstruction par IFFT, écoute et export du signal filtré.

---

## Contraintes techniques respectées

| Contrainte | Valeur |
|---|---|
| Fréquences autorisées | 16 kHz, 22,05 kHz, 44,1 kHz |
| Codage | 16 bits, 32 bits |
| Format audio | WAV uniquement |
| Type de filtre | Masque rectangulaire **uniquement** (passe-bande ou coupe-bande) |
| Framework web | Flask uniquement |
| Langage | Python 3.x |

---

## Structure du projet

```
TNS_PROJECT/
├── app.py                  # Serveur Flask — routes et logique backend
├── requirements.txt        # Dépendances Python
├── README.md
├── templates/
│   ├── base.html           # Layout commun (sidebar, topbar)
│   ├── index.html          # Page d'accueil
│   ├── partie1.html        # Interface Numérisation & Segmentation
│   └── partie2.html        # Interface FFT & Filtrage
├── static/
│   ├── css/style.css       # Styles (thème clair, Inter, Lucide Icons)
│   └── js/
│       ├── recorder.js     # Capture microphone via Web Audio API (PCM Float32)
│       ├── partie1.js      # Logique enregistrement, sauvegarde, segmentation
│       └── partie2.js      # Logique upload, Chart.js, filtrage
├── database/               # Base de données audio (locuteurs / sessions / fichiers)
│   └── locuteur_XX/
│       └── session_XX/
│           └── enreg_NNN_XXkHz_XXb.wav
├── segments/               # Segments vocaux extraits
└── uploads/                # Fichiers uploadés et filtrés (Partie 2)
```

---

## Installation

### 1. Créer et activer l'environnement virtuel

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux / macOS
source venv/bin/activate
```

### 2. Installer les dépendances

```bash
pip install -r requirements.txt
```

> **Note :** `pydub` nécessite **ffmpeg** pour convertir les formats MP3/OGG/FLAC.  
> Pour les fichiers WAV natifs, ffmpeg n'est pas requis.  
> Installation ffmpeg (Windows) : `winget install ffmpeg`

### 3. Lancer l'application

```bash
python app.py
```

Ouvrir dans le navigateur : [http://127.0.0.1:5000](http://127.0.0.1:5000)

---

## Utilisation

### Partie 1 — Numérisation & Segmentation

1. Choisir la **fréquence d'échantillonnage** (16 / 22,05 / 44,1 kHz) et le **codage** (16 / 32 bits).
2. Définir la **durée** d'enregistrement, le numéro de **locuteur** et de **session**.
3. Cliquer **Enregistrer** — le microphone est capturé via la Web Audio API (PCM Float32, sans ffmpeg).
4. Écouter la prévisualisation puis cliquer **Sauvegarder** — le fichier WAV est écrit dans `database/locuteur_XX/session_XX/`.
5. Le chemin est automatiquement rempli dans le panneau **Segmentation**.
6. Ajuster le **seuil d'amplitude** (dB) et la **durée minimale de segment** (ms), puis cliquer **Segmenter**.
7. Les segments sont listés avec lecture directe et téléchargement.

### Partie 2 — FFT & Filtrage

1. Glisser-déposer ou sélectionner un fichier audio (WAV, MP3, OGG…).
2. Le signal temporel **x(t)** et le spectre **|X(f)|** s'affichent via Chart.js.
3. Identifier visuellement les zones de bruit sur le spectre.
4. Saisir **f_min** et **f_max** (Hz), choisir **passe-bande** ou **coupe-bande**.
5. Cliquer **Appliquer le filtre** — le masque rectangulaire est appliqué dans le domaine fréquentiel, le signal est reconstruit par IFFT.
6. Les graphiques avant/après s'affichent, le signal filtré est lisible et téléchargeable.

---

## Formulation mathématique du filtre

```
         ⎧ 1   si f_min ≤ |f| ≤ f_max   (passe-bande)
H(f)  =  ⎨
         ⎩ 0   sinon

H̄(f) = 1 − H(f)                         (coupe-bande)
```

Implémentation : `scipy.fft.fft` → multiplication par le masque → `scipy.fft.ifft`

---

## Dépendances principales

| Package | Rôle |
|---|---|
| `flask` | Serveur web et routage |
| `numpy` | Calculs numériques |
| `scipy` | FFT / IFFT, lecture/écriture WAV |
| `librosa` | Segmentation par détection de silences |
| `soundfile` | Écriture WAV sans ffmpeg |
| `sounddevice` | (optionnel) accès microphone bas niveau |
| `pydub` | Conversion de formats audio (nécessite ffmpeg) |

Côté front : **Chart.js 4.4** (graphiques), **Lucide Icons** (icônes SVG)

---

