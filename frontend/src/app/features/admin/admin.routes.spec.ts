import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { BenutzerInfo } from '../../core/models/auth.model';
import { ADMIN_ROUTES } from './admin.routes';

// R5.11 / R5.12 — the `tickets` and `tickets/:id` routes dropped their
// `roleGuard('ROLE_ADMIN')`; `cron`, `agent-tasks`, and `agent-tasks/:id` keep
// theirs unchanged.
//
// `roleGuard()` is a factory: every call returns a brand-new closure, so two
// separately-created guards are never reference-equal (`toEqual` on the
// `canActivate` array can never pass). Instead, this spec pulls the actual
// guard function out of each route's `canActivate` array — the same approach
// `role.guard.spec.ts` uses — and executes it via
// `TestBed.runInInjectionContext(...)` against a mocked `AuthService`,
// asserting the outcome (allowed vs. redirected), never the guard's identity.

describe('ADMIN_ROUTES — guard composition', () => {
  const regularUser: BenutzerInfo = {
    id: 2,
    benutzername: 'user',
    vorname: 'Regular',
    nachname: 'User',
    email: 'user@test.de',
    rollen: ['ROLE_USER'],
    permissions: [],
  };

  let mockAuthService: { currentUser: ReturnType<typeof signal<BenutzerInfo | null>> };
  let router: Router;

  beforeEach(() => {
    const userSignal = signal<BenutzerInfo | null>(regularUser);

    mockAuthService = {
      currentUser: userSignal,
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigate');
  });

  function findRoute(path: string) {
    const route = ADMIN_ROUTES.find((r) => r.path === path);
    if (!route) {
      throw new Error(`No route found for path "${path}"`);
    }
    return route;
  }

  function runFirstGuard(path: string): boolean | Promise<boolean> {
    const route = findRoute(path);
    const guardFn = route.canActivate?.[0];
    if (!guardFn) {
      throw new Error(`Route "${path}" has no canActivate guard to run`);
    }
    return TestBed.runInInjectionContext(() =>
      (guardFn as any)(null as any, null as any),
    ) as boolean | Promise<boolean>;
  }

  describe('routes that still require ROLE_ADMIN', () => {
    it('rejects a ROLE_USER user on "cron" and redirects to /dashboard', () => {
      const result = runFirstGuard('cron');
      expect(result).toBeFalse();
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('rejects a ROLE_USER user on "agent-tasks" and redirects to /dashboard', () => {
      const result = runFirstGuard('agent-tasks');
      expect(result).toBeFalse();
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('rejects a ROLE_USER user on "agent-tasks/:id" and redirects to /dashboard', () => {
      const result = runFirstGuard('agent-tasks/:id');
      expect(result).toBeFalse();
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });
  });

  describe('routes opened up to any authenticated session', () => {
    it('has no roleGuard (or any guard) left in canActivate for "tickets"', () => {
      const route = findRoute('tickets');
      expect(route.canActivate ?? []).toEqual([]);
    });

    it('has no roleGuard (or any guard) left in canActivate for "tickets/:id"', () => {
      const route = findRoute('tickets/:id');
      expect(route.canActivate ?? []).toEqual([]);
    });
  });
});
