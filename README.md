# EDIGIX Quiz

## Firebase setup

1. In Firebase Console, open project `edigix-quizz`.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create a Firestore database.
4. Install the Firebase CLI, run `firebase login`, then run `firebase deploy --only firestore:rules` from this project.
5. Start the app with `npm run dev`.

Teachers register themselves. A logged-in teacher creates student Firebase Auth accounts from the teacher dashboard. Students then log in with the email and password assigned by the teacher.

The Firebase web configuration is in `src/firebase.js`; environment variables from `.env` override its values.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
