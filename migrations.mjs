// Additive, versioned migrations; never infer meal context for existing records.
export function migrateMealContext(db){
 if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get())return;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec("ALTER TABLE records ADD COLUMN mealContext TEXT CHECK(mealContext IS NULL OR mealContext='after_meal')");
  db.prepare('INSERT INTO schema_migrations VALUES (2,?)').run(new Date().toISOString());
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
