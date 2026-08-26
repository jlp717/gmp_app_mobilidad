import 'package:analyzer/error/error.dart' hide LintCode;
import 'package:analyzer/error/listener.dart';
import 'package:custom_lint_builder/custom_lint_builder.dart';

/// Creates GMP custom lint plugin.
PluginBase createPlugin() => _GmpLintsPlugin();

class _GmpLintsPlugin extends PluginBase {
  @override
  List<LintRule> getLintRules(CustomLintConfigs configs) => [
        const NoFlutterInDomain(),
      ];
}

/// Prevents Flutter dependencies from leaking into domain layers.
class NoFlutterInDomain extends DartLintRule {
  /// Creates domain purity lint rule.
  const NoFlutterInDomain() : super(code: _code);

  static const _code = LintCode(
    name: 'no_flutter_in_domain',
    problemMessage: "domain/ no debe importar 'package:flutter/'. Mueve esta "
        'dependencia a presentation/ o extrae el tipo puro.',
    errorSeverity: ErrorSeverity.ERROR,
  );

  @override
  void run(
    CustomLintResolver resolver,
    ErrorReporter reporter,
    CustomLintContext context,
  ) {
    final path = resolver.path.replaceAll(r'\', '/');
    if (!path.contains('/domain/')) return;

    context.registry.addImportDirective((node) {
      final uri = node.uri.stringValue;
      if (uri != null && uri.startsWith('package:flutter/')) {
        reporter.atNode(node, code);
      }
    });
  }
}
