/**
 * Express middleware factories for common route guards.
 * Extracted from management.js to eliminate repeated 404-check boilerplate.
 */

/**
 * Middleware that loads the client record for `req.params.id` from the DB.
 * Responds with 404 JSON if not found; otherwise sets `req.client` and calls next().
 * @param {ReturnType<import("./db.js").createDatabase>} db
 * @returns {import("express").RequestHandler}
 */
export function requireClient(db) {
  return (req, res, next) => {
    const client = db.getClient(req.params.id);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    req.client = client;
    next();
  };
}

/**
 * Middleware that loads the link record for `req.params.id` from the DB.
 * Responds with 404 JSON if not found; otherwise sets `req.link` and calls next().
 * @param {ReturnType<import("./db.js").createDatabase>} db
 * @returns {import("express").RequestHandler}
 */
export function requireLink(db) {
  return (req, res, next) => {
    const link = db.getLink(req.params.id);
    if (!link) {
      res.status(404).json({ error: "Link not found" });
      return;
    }
    req.link = link;
    next();
  };
}
