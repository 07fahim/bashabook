-- false = cooks for themselves: no meals by default, still shares rent and bills
alter table members add column in_meals boolean not null default true;
