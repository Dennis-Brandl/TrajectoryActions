import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '002-action-timeout',
  up(db) {
    db.exec(`ALTER TABLE actions ADD COLUMN timeout_seconds INTEGER DEFAULT NULL`)
  },
}
