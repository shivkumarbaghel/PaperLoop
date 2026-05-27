const testLoginAliases: Record<string, string> = {
  admin: "admin@paperloop.test",
  aajtak: "aajtak@paperloop.test",
  livehindustan: "livehindustan@paperloop.test",
  amarujala: "amarujala@paperloop.test",
  prabhatkhabar: "prabhatkhabar@paperloop.test",
  jagran: "jagran@paperloop.test",
  navodayatimes: "navodayatimes@paperloop.test",
};

export function resolveLoginEmailInput(loginInput: string) {
  const normalizedLogin = loginInput.trim().toLowerCase();

  return testLoginAliases[normalizedLogin] ?? normalizedLogin;
}

