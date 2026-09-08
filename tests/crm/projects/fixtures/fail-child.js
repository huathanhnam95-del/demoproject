'use strict';

process.stdout.write('FAIL-CHILD-STDOUT\n');
process.stderr.write('FAIL-CHILD-STDERR\n');
process.exitCode = 17;

