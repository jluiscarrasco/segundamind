# Migración de Supabase a Firebase

Este documento describe el progreso de la migración de Supabase → Firebase y los pasos necesarios para completarla.

## ✅ Completado (Fases 1-4)

### Phase 1: Setup Firebase
- ✅ Proyecto Firebase creado
- ✅ Firebase config (`src/integrations/firebase/config.ts`)
- ✅ Dependencias instaladas (`firebase`, `firebase-admin`)
- ✅ Variables de entorno configuradas (`.env`)

### Phase 2: Autenticación
- ✅ `AuthContext.tsx` → Firebase Auth
- ✅ `LoginPage.tsx` → Firebase Auth
- ✅ `ResetPasswordPage.tsx` → Firebase Auth

### Phase 3: Data Layer
- ✅ `useStore.ts` → Cloud Firestore
- ✅ Real-time listeners implementadas
- ✅ Todos los CRUD operations actualizados

### Phase 4: Seguridad
- ✅ Firestore Security Rules creadas (`firestore.rules`)
- ✅ RLS policies configuradas (userId-based)

## ⏳ Próximos pasos

### 1. Aplicar Firestore Security Rules

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Deploy security rules
firebase deploy --only firestore:rules
```

### 2. Crear colecciones de Firestore

En Firebase Console:
1. Ve a Firestore Database
2. Crea las siguientes colecciones (vacías inicialmente):
   - `areas`
   - `projects`
   - `tasks`
   - `inbox_items`
   - `resources`
   - `wiki_pages`
   - `user_folders`
   - `user_files`
   - `user_file_tags`
   - `user_file_links`
   - `api_tokens`
   - `push_subscriptions`
   - `allowed_emails`

### 3. Obtener Firebase Service Account Key

1. En Firebase Console → Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Guarda como `firebase-key.json` en el root del proyecto
4. **⚠️ No commits esto a git** (ya está en `.gitignore`)

### 4. Migrar datos de Supabase

```bash
# Install dependencies
npm install @supabase/supabase-js

# Run migration script
node scripts/migrate-supabase-to-firebase.js
```

Este script:
- Lee todos los datos de Supabase
- Convierte snake_case → camelCase
- Importa a Firestore en batches
- Reporta progreso y errores

**Tiempo esperado**: 2-5 minutos (depende del volumen de datos)

### 5. Migrar Storage (Archivos)

Próximamente: `useDrive.ts` → Cloud Storage

### 6. Migrar Cloud Functions

Próximamente: Supabase Edge Functions → Firebase Cloud Functions

## 📋 Checklist de Migración

- [ ] Firestore Security Rules desplegadas
- [ ] Colecciones creadas en Firestore
- [ ] Firebase Service Account Key descargada
- [ ] Datos migrados con éxito
- [ ] App testea correctamente
- [ ] `useDrive.ts` migrado
- [ ] Cloud Functions migradas
- [ ] Supabase puede ser descomisionado

## 🔧 Troubleshooting

### Error: "Firebase Service Account Key not found"
```
Solución: Descarga la key de Firebase Console > Project Settings > Service Accounts
```

### Error: "SUPABASE_SERVICE_ROLE_KEY required"
```
Solución: Agrega SUPABASE_SERVICE_ROLE_KEY a .env
```

### Error: "Permission denied" en Firestore
```
Solución: Deploya las Firestore Security Rules (firebase deploy --only firestore:rules)
```

### Los datos no aparecen después de migrar
```
Solución:
1. Verifica que los datos llegaron a Firestore (Console > Data)
2. Verifica que userId matches en los documentos
3. Reinicia el servidor de desarrollo
```

## 🚀 Comandos útiles

```bash
# Check migration status
firebase firestore:delete --all --project secondbrain-765b9

# View Firestore data
firebase firestore:list --project secondbrain-765b9

# Redeploy security rules
firebase deploy --only firestore:rules --project secondbrain-765b9

# Clear all Firestore data
firebase firestore:delete --recursive --project secondbrain-765b9
```

## 📝 Notas

- Firebase Firestore tiene un modelo de datos más simple que Supabase (no soporta stored procedures, funciones, etc.)
- Los Cloud Functions serán más sencillos que las Edge Functions de Supabase
- El costo de Firestore puede variar según el volumen de lectura/escritura (monitor el usage)

## 🔗 Referencias

- [Firebase Console](https://console.firebase.google.com)
- [Firestore Docs](https://firebase.google.com/docs/firestore)
- [Firebase CLI Docs](https://firebase.google.com/docs/cli)
