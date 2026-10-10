-- days and meals the cook is off; members can't switch these on, the flat's starter can still edit
create table no_cook (
  flat_id uuid not null references flats on delete cascade,
  date    date not null,
  meal    char(1) not null check (meal in ('b','l','d')),
  primary key (flat_id, date, meal)
);
