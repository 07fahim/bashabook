-- Each person can mute the push for changes to today's meals (lib/meal-push) and keep every other reminder. On by
-- default: whoever is home tells the cook, so everyone hears unless they choose not to.
alter table members add column meal_push boolean not null default true;
