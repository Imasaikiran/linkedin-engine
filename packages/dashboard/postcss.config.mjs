// Local config so Next uses Tailwind v4 here and does not walk up the tree to an
// ancestor postcss.config (the home dir has one).
export default { plugins: { "@tailwindcss/postcss": {} } };
