/**
 * Brand Builder Database Path
 *
 * Canonical location for the on-disk SQLite database.
 * Resolves to .opencode/brand-builder/data/brand-builder.db
 */

const path = require("path");

const DB_PATH = path.join(__dirname, "data", "brand-builder.db");

module.exports = { DB_PATH };
