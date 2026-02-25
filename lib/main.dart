import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';

void main() {
  runApp(const AutoWebScrollerApp());
}

class AutoWebScrollerApp extends StatelessWidget {
  const AutoWebScrollerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Scrolly',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF1C1C1E),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF30D158),
          surface: Color(0xFF2C2C2E),
        ),
        fontFamily: '.SF Pro Text',
      ),
      home: const MainScreen(),
    );
  }
}

class MainScreen extends StatelessWidget {
  const MainScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── App icon + title ──────────────────────────────────────────
              Row(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF30D158), Color(0xFF25A244)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.swap_vert_rounded,
                      color: Colors.white,
                      size: 32,
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Scrolly',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.5,
                        ),
                      ),
                      Text(
                        'Safari 자동 스크롤 확장 프로그램',
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.white60,
                        ),
                      ),
                    ],
                  ),
                ],
              ),

              const SizedBox(height: 32),

              // ── How to enable ─────────────────────────────────────────────
              _SectionCard(
                title: '시작하는 방법',
                icon: Icons.rocket_launch_rounded,
                iconColor: const Color(0xFF30D158),
                child: const Column(
                  children: [
                    _StepRow(
                      number: '1',
                      text: 'iPhone/iPad에서 Safari를 엽니다',
                    ),
                    _StepRow(
                      number: '2',
                      text: '설정 앱 → Safari → 확장 프로그램으로 이동합니다',
                    ),
                    _StepRow(
                      number: '3',
                      text: 'AutoWebScroller를 켭니다',
                    ),
                    _StepRow(
                      number: '4',
                      text: 'Safari에서 원하는 사이트에 접속 후\n주소 표시줄의 AA 버튼을 탭하세요',
                      isLast: true,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // ── Features ──────────────────────────────────────────────────
              _SectionCard(
                title: '주요 기능',
                icon: Icons.auto_awesome_rounded,
                iconColor: const Color(0xFF0A84FF),
                child: const Column(
                  children: [
                    _FeatureRow(
                      icon: Icons.speed_rounded,
                      color: Color(0xFF30D158),
                      title: '속도 조절',
                      subtitle: '1x ~ 20x 범위에서 원하는 속도로',
                    ),
                    _FeatureRow(
                      icon: Icons.swap_vert_rounded,
                      color: Color(0xFF0A84FF),
                      title: '방향 전환',
                      subtitle: '위/아래 방향 선택 가능',
                    ),
                    _FeatureRow(
                      icon: Icons.loop_rounded,
                      color: Color(0xFFFF9F0A),
                      title: '루프 모드',
                      subtitle: '페이지 끝에서 처음으로 자동 복귀',
                    ),
                    _FeatureRow(
                      icon: Icons.pan_tool_rounded,
                      color: Color(0xFFFF453A),
                      title: '자동 일시정지',
                      subtitle: '화면 터치 즉시 멈춤, 1.5초 후 자동 재개',
                    ),
                    _FeatureRow(
                      icon: Icons.timer_rounded,
                      color: Color(0xFFBF5AF2),
                      title: '타이머',
                      subtitle: '최대 60분 후 자동 정지',
                    ),
                    _FeatureRow(
                      icon: Icons.bookmark_rounded,
                      color: Color(0xFF64D2FF),
                      title: '사이트별 설정 저장',
                      subtitle: '사이트마다 다른 속도/옵션 기억',
                    ),
                    _FeatureRow(
                      icon: Icons.touch_app_rounded,
                      color: Color(0xFF32ADE6),
                      title: '제스처 단축키',
                      subtitle: '더블탭 일시정지, 트리플탭 속도 초기화',
                    ),
                    _FeatureRow(
                      icon: Icons.smart_screen_rounded,
                      color: Color(0xFFFF9F0A),
                      title: '콘텐츠 인식 속도',
                      subtitle: '광고 구간 빠르게, 이미지 구간 느리게 자동 조절',
                    ),
                    _FeatureRow(
                      icon: Icons.widgets_rounded,
                      color: Color(0xFFBF5AF2),
                      title: '플로팅 위젯',
                      subtitle: '드래그 가능한 미니 컨트롤 오버레이',
                      isLast: true,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // ── Tips ──────────────────────────────────────────────────────
              _SectionCard(
                title: '사용 팁',
                icon: Icons.lightbulb_rounded,
                iconColor: const Color(0xFFFF9F0A),
                child: const Column(
                  children: [
                    _TipRow(text: '독서할 때는 속도 2~4x, 빠른 스캔은 8x 이상을 추천해요'),
                    _TipRow(text: '루프 모드를 켜면 긴 뉴스 피드를 자동으로 계속 읽을 수 있어요'),
                    _TipRow(text: '취침 전 사용 시 타이머를 설정해 자동으로 꺼지게 하세요'),
                    _TipRow(
                      text: '플로팅 위젯을 드래그해 원하는 위치에 고정할 수 있어요',
                      isLast: true,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 32),

              // ── Version ───────────────────────────────────────────────────
              Center(
                child: Text(
                  'Version 1.1.0',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.white.withOpacity(0.3),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Sub-widgets ──────────────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color iconColor;
  final Widget child;

  const _SectionCard({
    required this.title,
    required this.icon,
    required this.iconColor,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF2C2C2E),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(
              children: [
                Icon(icon, color: iconColor, size: 18),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.3,
                    color: Colors.white70,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0xFF3A3A3C)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: child,
          ),
        ],
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  final String number;
  final String text;
  final bool isLast;

  const _StepRow({
    required this.number,
    required this.text,
    this.isLast = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 4 : 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: const Color(0xFF30D158),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: Text(
                number,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(text, style: const TextStyle(fontSize: 14, height: 1.4)),
          ),
        ],
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final bool isLast;

  const _FeatureRow({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    this.isLast = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(fontSize: 12, color: Colors.white54),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (!isLast)
          const Divider(height: 1, color: Color(0xFF3A3A3C), indent: 48),
      ],
    );
  }
}

class _TipRow extends StatelessWidget {
  final String text;
  final bool isLast;

  const _TipRow({required this.text, this.isLast = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: 8, bottom: isLast ? 4 : 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('•  ', style: TextStyle(color: Color(0xFFFF9F0A))),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 13,
                height: 1.5,
                color: Colors.white70,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
