import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

// NOTE: Gates the deprecated calendar category-rule generate/classify routes (TaskController) from production.
@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return true;
  }
}
