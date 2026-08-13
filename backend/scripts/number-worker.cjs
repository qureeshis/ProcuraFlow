process.env.DB_PATH=process.argv[2];
const {nextDocNumber}=require('../dist/utils/numbering');
process.stdout.write(nextDocNumber(process.argv[3]));
