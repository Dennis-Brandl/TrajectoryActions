import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '003-lifecycle-state',
  up(db) {
    db.exec(`
      ALTER TABLE actions ADD COLUMN state TEXT NOT NULL DEFAULT 'Draft'
        CHECK(state IN ('Draft','InTest','InReview','Approved','Effective','Superseded','Obsolete'))
    `)
    db.exec(`
      ALTER TABLE environments ADD COLUMN state TEXT NOT NULL DEFAULT 'Draft'
        CHECK(state IN ('Draft','InTest','InReview','Approved','Effective','Superseded','Obsolete'))
    `)
  },
}
