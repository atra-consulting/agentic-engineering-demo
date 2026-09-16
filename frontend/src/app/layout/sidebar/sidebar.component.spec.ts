import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { faListCheck } from '@fortawesome/free-solid-svg-icons';
import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService } from '../../core/services/layout.service';
import { BenutzerInfo } from '../../core/models/auth.model';

describe('SidebarComponent', () => {
  const adminUser: BenutzerInfo = {
    id: 1,
    benutzername: 'admin',
    vorname: 'Admin',
    nachname: 'User',
    email: 'admin@test.de',
    rollen: ['ROLE_ADMIN', 'ROLE_USER'],
    permissions: [],
  };

  const regularUser: BenutzerInfo = {
    id: 2,
    benutzername: 'user',
    vorname: 'Regular',
    nachname: 'User',
    email: 'user@test.de',
    rollen: ['ROLE_USER'],
    permissions: [],
  };

  let fixture: ComponentFixture<SidebarComponent>;
  let component: SidebarComponent;
  let mockAuthService: { currentUser: ReturnType<typeof signal<BenutzerInfo | null>> };
  let mockLayoutService: { collapsed: ReturnType<typeof signal<boolean>>; toggleSidebar: jasmine.Spy };

  beforeEach(async () => {
    const userSignal = signal<BenutzerInfo | null>(null);
    const collapsedSignal = signal<boolean>(false);

    mockAuthService = {
      currentUser: userSignal,
    };

    mockLayoutService = {
      collapsed: collapsedSignal,
      toggleSidebar: jasmine.createSpy('toggleSidebar'),
    };

    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
        { provide: LayoutService, useValue: mockLayoutService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders item without requiredRole for any user', () => {
    mockAuthService.currentUser.set(regularUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Dashboard');
  });

  it('renders item with requiredRole ADMIN when user has ADMIN role', () => {
    mockAuthService.currentUser.set(adminUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('App-Feedback');
  });

  it('hides item with requiredRole ADMIN when user only has USER role', () => {
    mockAuthService.currentUser.set(regularUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('App-Feedback');
  });

  // The real "Administration" section can no longer end up fully hidden for any
  // role: "Tickets" has no requiredRole (PRD-SYNC-LAB-IMPROVEMENTS.md, Open
  // Question 3) and always keeps the section visible. The section-hiding logic in
  // visibleItems() is still real code though, so it's exercised directly here with
  // a synthetic, all-admin item list instead of a real section.
  it('visibleItems returns an empty array when every item requires ROLE_ADMIN and the user only has ROLE_USER', () => {
    mockAuthService.currentUser.set(regularUser);
    const adminOnlyItems = [
      { label: 'Foo', route: '/foo', icon: faListCheck, requiredRole: 'ROLE_ADMIN' },
      { label: 'Bar', route: '/bar', icon: faListCheck, requiredRole: 'ROLE_ADMIN' },
    ];
    expect(component.visibleItems(adminOnlyItems)).toEqual([]);
  });

  it('renders the Administration section header when user has ADMIN role', () => {
    mockAuthService.currentUser.set(adminUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Administration');
  });

  it('renders the Administration section header for a USER-role user, showing only Tickets inside it', () => {
    mockAuthService.currentUser.set(regularUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Administration');
    expect(text).toContain('Tickets');
    expect(text).not.toContain('App-Feedback');
    expect(text).not.toContain('Cron-Jobs');
  });

  it('renders a Feedback link pointing to /feedback in the bottom nav', () => {
    mockAuthService.currentUser.set(regularUser);
    fixture.detectChanges();
    const bottomUl = fixture.debugElement.query(By.css('ul.nav.mt-auto'));
    expect(bottomUl).toBeTruthy();
    const linkDebugEl = bottomUl.query(By.directive(RouterLink));
    expect(linkDebugEl).toBeTruthy();
    const anchor = linkDebugEl.nativeElement as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/feedback');
    expect((anchor.textContent as string)).toContain('Trainings-Feedback');
  });

  it('shows "Tickets" for a USER-role user (no requiredRole gate on that item)', () => {
    mockAuthService.currentUser.set(regularUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Tickets');
  });

  it('does not show "App-Feedback" or "Cron-Jobs" for a USER-role user', () => {
    mockAuthService.currentUser.set(regularUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('App-Feedback');
    expect(text).not.toContain('Cron-Jobs');
  });

  it('shows "Tickets", "App-Feedback", and "Cron-Jobs" for an ADMIN-role user', () => {
    mockAuthService.currentUser.set(adminUser);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Tickets');
    expect(text).toContain('App-Feedback');
    expect(text).toContain('Cron-Jobs');
  });

  it('hides the Feedback label but keeps the link clickable when collapsed', () => {
    mockAuthService.currentUser.set(regularUser);
    mockLayoutService.collapsed.set(true);
    fixture.detectChanges();
    const bottomUl = fixture.debugElement.query(By.css('ul.nav.mt-auto'));
    expect(bottomUl).toBeTruthy();
    const linkDebugEl = bottomUl.query(By.directive(RouterLink));
    expect(linkDebugEl).toBeTruthy();
    const anchor = linkDebugEl.nativeElement as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/feedback');
    expect((anchor.textContent as string).trim()).not.toContain('Feedback');
  });
});
