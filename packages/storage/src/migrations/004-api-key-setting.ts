import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '004-api-key-setting',
  up(db) {
    // Seed the api_key setting (empty = open access). INSERT OR IGNORE so it is
    // added to pre-existing databases that ran 001 before api_key existed, and
    // is a no-op on fresh databases where 001..003 already ran.
    db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, default_value, description, value_type)
       VALUES ('api_key', '', '', 'API key required on protected routes (X-API-Key header). Empty = open access.', 'string')`
    ).run()
  },
}
