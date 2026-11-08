-- Students sign in with their phone number; bookings are one row per class they sign up for.
CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL UNIQUE,   -- +1XXXXXXXXXX
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_date  TEXT NOT NULL,          -- YYYY-MM-DD (studio time)
  class_time  TEXT NOT NULL,          -- HH:MM 24h
  class_name  TEXT NOT NULL,          -- copied at sign-up so history survives schedule edits
  created_at  TEXT NOT NULL,
  UNIQUE (student_id, class_date, class_time)
);

CREATE INDEX IF NOT EXISTS bookings_by_class ON bookings (class_date, class_time);
CREATE INDEX IF NOT EXISTS bookings_by_student ON bookings (student_id, class_date);
