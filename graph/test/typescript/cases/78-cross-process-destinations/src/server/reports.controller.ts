// The server end in the decorator form: the class route is a prefix of every method route.
function Controller(_path: string) { return (_t: Function): void => {}; }
function Get(_path: string) { return (_t: object, _k: string, _d: PropertyDescriptor): void => {}; }
function Post(_path: string) { return (_t: object, _k: string, _d: PropertyDescriptor): void => {}; }

@Controller('api/reports')
export class ReportsController {
  @Get(':day')
  daily(): string { return 'daily'; }

  @Post('rebuild')
  rebuild(): string { return 'rebuilt'; }

  // no route decorator: served by nothing
  helper(): string { return 'helper'; }
}
