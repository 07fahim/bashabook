-- each person's own mobile number (01XXXXXXXXX), optional; everyone in the flat can see it and call them
alter table members add column phone text check (phone ~ '^01[3-9][0-9]{8}$');
