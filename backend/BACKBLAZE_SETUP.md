# Configuration Backblaze B2 pour Noovy

Ce guide explique comment configurer Backblaze B2 pour remplacer Archive.org comme source de stockage des livres.

## Prérequis

- Compte Backblaze B2 créé
- Bucket B2 créé pour stocker les livres
- Clés d'application B2 générées

## Configuration

### 1. Créer le fichier .env

Dans le dossier `backend/`, créez un fichier `.env` avec les variables suivantes :

```env
# Backblaze B2 Configuration
B2_KEY_ID=votre_key_id_ici
B2_APPLICATION_KEY=votre_application_key_ici
B2_BUCKET_NAME=nom_de_votre_bucket
B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
B2_REGION=eu-central-003

# Database (existant)
DATABASE_URL=postgresql://...
JWT_SECRET=votre_secret
```

### 2. Obtenir vos credentials Backblaze

1. Connectez-vous à [Backblaze B2](https://backblaze.com/b2)
2. Allez dans "App Keys" (Clés d'application)
3. Créez une nouvelle clé d'application avec accès au bucket
4. Notez :
   - **keyID** → `B2_KEY_ID`
   - **applicationKey** → `B2_APPLICATION_KEY`
   - **Nom du bucket** → `B2_BUCKET_NAME`

### 3. Endpoint et Région

Backblaze B2 utilise une API compatible S3. Les endpoints courants :

- EU Central : `https://s3.eu-central-003.backblazeb2.com`
- US West : `https://s3.us-west-002.backblazeb2.com`
- US East : `https://s3.us-east-005.backblazeb2.com`

### 4. Format des fichiers

Nommez vos PDFs selon ce format pour une bonne extraction des métadonnées :

```
[Auteur] - [Titre].pdf
```

Exemples :
- `Victor Hugo - Les Miserables.pdf`
- `Alexandre Dumas - Le Comte de Monte-Cristo.pdf`

### 5. Installation des dépendances

```bash
cd backend
npm install
```

### 6. Tester la connexion

```bash
npm run test:b2
```

Ce script vérifie :
- La connexion à B2
- La liste des livres dans le bucket
- La génération d'URLs signées

## Fonctionnement

### URLs signées

Pour des raisons de sécurité, le service génère des **URLs signées** (temporaires) valides 1 heure. Cela évite d'exposer publiquement vos fichiers.

Si vous préférez des URLs directes (bucket public), utilisez `getDirectPdfUrl()` dans le service.

### Cache

Les listes de livres sont mises en cache 5 minutes pour optimiser les performances.

### Migration depuis Archive.org

L'ancien service `archive.js` est remplacé par `backblaze.js`. La route `/api/books` fonctionne de la même manière, mais récupère les livres depuis B2 au lieu d'Archive.org.

## Dépannage

### "Connection failed"
- Vérifiez que `B2_KEY_ID` et `B2_APPLICATION_KEY` sont corrects
- Vérifiez que le bucket existe
- Vérifiez que la clé a les permissions nécessaires

### "No PDF found"
- Assurez-vous que les fichiers ont l'extension `.pdf`
- Vérifiez que les fichiers sont bien dans le bucket racine (pas dans un sous-dossier)

### URLs qui ne fonctionnent pas
- Les URLs signées expirent après 1 heure (comportement normal)
- Vérifiez que le bucket est accessible depuis votre région

## Structure des fichiers modifiés

```
backend/
├── services/
│   ├── backblaze.js      # Nouveau service B2
│   └── archive.js        # Ancien service (conservé pour référence)
├── routes/
│   └── books.js          # Utilise maintenant backblaze.js
├── package.json          # Ajout de @aws-sdk/s3-request-presigner
├── test_backblaze.js     # Script de test
└── .env                  # À créer avec vos credentials
```
