import 'package:analyzer/error/error.dart';
import 'package:custom_lint_builder/custom_lint_builder.dart';

PluginBase plugin = _GmpLintsPlugin();

class _GmpLintsPlugin extends PluginBase {
  @override
  List<LintRule> getLintRules(CustomLintConfigs configs) => [
        const NoFlutterInDomain(),
      ];
}

/// Arquitectura por capas: `domain/` no puede depender de Flutter.
/// Las entidades de dominio son Dart puro; UI va en presentation/.
class NoFlutterInDomain extends LintRule {
  const NoFlutterInDomain()
      : super(
          code: const LintCode(
            name: 'no_flutter_in_domain',
            problemMessage:
                "domain/ no debe importar 'package:flutter/'. Mueve esta "
                'dependencia a presentation/ o extrae el tipo puro.',
            errorSeverity: ErrorSeverity.ERROR,
          ),
        );

  @override
  void run(
    CustomLintResolver resolver,
    ErrorReporter reporter,
    CustomLintContext context,
  ) {
    final path = resolver.path.replaceAll('\\', '/');
    if (!path.contains('/domain/')) return;

    context.registry.addImportDirective((node) {
      final uri = node.uri.stringValue;
      if (uri != null && uri.startsWith('package:flutter/')) {
        reporter.reportErrorForNode(code, node);
      }
    });
  }
}
