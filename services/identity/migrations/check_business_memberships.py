# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
"""Standalone SQLite migration regression: python this_file.py."""
import sqlite3
from pathlib import Path

connection = sqlite3.connect(':memory:')
connection.execute('PRAGMA foreign_keys=ON')
connection.execute('CREATE TABLE identities(pub_dress TEXT PRIMARY KEY)')
script = Path(__file__).with_name('0039_business_memberships.sql').read_text()
connection.executescript(script)
connection.executescript(script)
connection.executemany('INSERT INTO identities VALUES (?)', [('business',), ('member',)])
connection.execute("INSERT INTO business_memberships VALUES ('business','member','owner',1)")
for business, member, role in [('missing','member','owner'), ('business','member','member'), ('member','member','owner'), ('member','business','special')]:
    try:
        connection.execute('INSERT INTO business_memberships VALUES (?,?,?,1)', (business, member, role))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('Invalid membership accepted')
connection.execute("UPDATE identities SET pub_dress='renamed' WHERE pub_dress='member'")
assert connection.execute('SELECT member_pub_dress,role FROM business_memberships').fetchone() == ('renamed','owner')
connection.execute("DELETE FROM identities WHERE pub_dress='business'")
assert connection.execute('SELECT COUNT(*) FROM business_memberships').fetchone()[0] == 0
print('PASS: replay, FK, uniqueness, self-membership, role vocabulary, rename and delete cascade')
