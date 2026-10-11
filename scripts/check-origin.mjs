// Exercises Next's Server Action origin check against a running build (http://localhost:3000). Posts the plain "join by code"
// form action (no sign-in, no write) three ways: a foreign Origin (must be refused: 500 and "Invalid Server Actions request"
// in the server log), the app's own Origin (a 303 to the code's join page), and no Origin (Next allows it with a warning).
const B = 'http://localhost:3000', CODE = process.argv[2] ?? 'JYVBKW';   // any code works: a wrong one still gets the same-origin 303
const page = await (await fetch(`${B}/en/join`)).text();
const actionId = /\$ACTION_ID_([0-9a-f]+)/.exec(page)?.[1];
if (!actionId) { console.log('no form action id on /en/join'); process.exit(1); }
const post = async (origin) => {
  const fd = new FormData();
  fd.set('lang', 'en'); fd.set('code', CODE); fd.set(`$ACTION_ID_${actionId}`, '');
  const headers = origin ? { Origin: origin } : {};
  const r = await fetch(`${B}/en/join`, { method: 'POST', body: fd, headers, redirect: 'manual' });
  return { origin: origin ?? '(none)', status: r.status, location: r.headers.get('location') ?? '-' };
};
console.log(await post('https://evil.example'));
console.log(await post(B));
console.log(await post(null));
