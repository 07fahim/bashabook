-- Anonymous actions (new flat, join lookup, PIN post) counted per connection and hour. Rows older than two hours are
-- swept by the next count, so the table holds the live hour and the one before.
create table rate_limits (
  key  text        not null,
  hour timestamptz not null,
  n    int         not null default 1,
  primary key (key, hour)
);
