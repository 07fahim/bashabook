/** What Google Analytics is told about a page: a join link's flat code is hidden (it lets anyone into the flat's sign-in
 *  page). Query strings never go at all (they carry member ids); the caller sends the path only. */
export const gaPath = (path: string) => path.replace(/\/j\/[^/]+/, '/j/code');

/** The page someone came from, as Google Analytics is told it: the same cleaning, and no query string or fragment (gtag.js
 *  would otherwise send the full previous address, join code and member ids included). */
export const gaRef = (url: string) => gaPath(url.split(/[?#]/)[0]);
