-- Kobe.ai schema. Plain Postgres: runs on Neon or any self-hosted Postgres 15+.

create table if not exists people (
  id          text primary key,
  name        text not null,
  role        text,
  tier        text not null default 'ROTATION',
  birthday    text,
  last_touch  text,
  next_up     text,
  rapport     int  not null default 50 check (rapport between 0 and 100),
  points      jsonb not null default '[]',
  open_loop   text,
  sources     text[] not null default '{}'
);

create table if not exists season (
  id      text primary key default 'me',
  xp      int not null default 0,
  assists int not null default 0,
  streak  int not null default 0
);

-- Every message Kobe sends on your behalf is an "assist".
create table if not exists touches (
  id         bigserial primary key,
  person_id  text references people(id) on delete cascade,
  channel    text not null,
  body       text,
  created_at timestamptz not null default now()
);

-- Daily game plan completions.
create table if not exists plays (
  day     date not null default current_date,
  play_id text not null,
  primary key (day, play_id)
);

insert into season (id, xp, assists, streak) values ('me', 180, 12, 6)
on conflict (id) do nothing;

insert into people (id, name, role, tier, birthday, last_touch, next_up, rapport, points, open_loop, sources) values
  ('maya',   'Maya Chen',   'College roommate',        'STARTING FIVE', 'Oct 5 · tomorrow · turns 29', 'Instagram DM · 6 weeks ago',        'Nothing scheduled',                   82, '["Moved to Brooklyn in August","Training for the NYC Half in March","Favorite spot: Bunna Cafe"]', 'She asked for your running playlist.', '{INSTAGRAM,GMAIL}'),
  ('marcus', 'Marcus Reid', 'Former manager · mentor', 'ROTATION',      'Feb 11',                       'Fathom call · Sep 12',              'Coffee today 3:30 PM · Blue Bottle',  74, '["Relocated to Austin in August","Daughter just started kindergarten","Thinking about advising early-stage teams"]', 'You promised an intro to Lena Ortiz.', '{FATHOM,GMAIL,"GOOGLE CALENDAR"}'),
  ('jordan', 'Jordan Blake','Friend from rec league',  'STARTING FIVE', 'Oct 9',                        'Partiful RSVP · 4 days ago',        'Dinner Thu 7:00 PM · Nopa',           88, '["Just adopted a dog named Biscuit","Tore an ACL in June, back on court now","Hosting the dinner for 6"]', 'Thursday dinner clashes with Product sync.', '{PARTIFUL,INSTAGRAM}'),
  ('priya',  'Priya Nair',  'Ex-colleague',            'BENCH',         'Oct 13',                       'LinkedIn like · 2 months ago',      'Nothing scheduled',                   61, '["Started as Head of Design at Northwind","Ran her first marathon last spring","Prefers voice notes over texts"]', 'You both said "coffee soon" in July.', '{LINKEDIN,GMAIL}'),
  ('dev',    'Dev Patel',   'Cousin',                  'STARTING FIVE', 'Jan 22',                       'WhatsApp · 9 days ago (unanswered)','Family dinner Oct 18',                 79, '["Asked if you can help him move on the 17th","Started a new job at a robotics lab","Rooting hard for the home team this season"]', 'Reply about helping him move.', '{WHATSAPP,"GOOGLE CALENDAR"}')
on conflict (id) do nothing;
