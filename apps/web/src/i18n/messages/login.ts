/** 로그인 화면 — 레일이 아직 없는 유일한 화면이라 언어 전환기도 여기 따로 있다. */
export const login = {
  'login.sub': ['계속하려면 로그인하세요', 'Sign in to continue'],
  'login.email': ['이메일', 'Email'],
  'login.password': ['비밀번호', 'Password'],
  'login.submit': ['로그인', 'Sign in'],
  'login.failed': ['로그인에 실패했습니다', 'Login failed'],
  'login.hintNoAccount': [
    '계정이 없다면 관리자에게 요청하세요.',
    "If you don't have an account, ask your administrator.",
  ],
  'login.hintAdminBefore': ['초기 관리자는 서버에서 ', 'Create the initial admin on the server with '],
  'login.hintAdminAfter': [' 로 만듭니다.', '.'],
} as const
