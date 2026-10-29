// a command-line builder chained two dozen times at module level: linear work, not one evaluation per path
export class Command {
  private flags: string[] = []
  command(name: string): Command {
    this.flags.push(name)
    return this
  }
  option(flag: string, help: string): Command {
    this.flags.push(flag + ' ' + help)
    return this
  }
}

export const deploy = new Command()
  .command('deploy')
  .option('--flag-0', 'flag 0')
  .option('--flag-1', 'flag 1')
  .option('--flag-2', 'flag 2')
  .option('--flag-3', 'flag 3')
  .option('--flag-4', 'flag 4')
  .option('--flag-5', 'flag 5')
  .option('--flag-6', 'flag 6')
  .option('--flag-7', 'flag 7')
  .option('--flag-8', 'flag 8')
  .option('--flag-9', 'flag 9')
  .option('--flag-10', 'flag 10')
  .option('--flag-11', 'flag 11')
  .option('--flag-12', 'flag 12')
  .option('--flag-13', 'flag 13')
  .option('--flag-14', 'flag 14')
  .option('--flag-15', 'flag 15')
  .option('--flag-16', 'flag 16')
  .option('--flag-17', 'flag 17')
  .option('--flag-18', 'flag 18')
  .option('--flag-19', 'flag 19')
  .option('--flag-20', 'flag 20')
  .option('--flag-21', 'flag 21')
  .option('--flag-22', 'flag 22')
  .option('--flag-23', 'flag 23')
