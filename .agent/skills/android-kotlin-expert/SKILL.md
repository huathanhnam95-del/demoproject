---
name: android-kotlin-expert
description: Master Android development with Kotlin, Jetpack Compose, and modern architecture patterns. Specialized in UI/UX, performance, and platform-specific feature integration.
---

# Android Kotlin Expert

High-level guidance for modern Android application development.

## Use this skill when

- Building UIs with Jetpack Compose.
- Writing asynchronous code with Kotlin Coroutines and Flow.
- Implementing Android Architecture Components (ViewModel, Hilt, Room).
- Managing app lifecycle and system events.
- Optimizing battery and memory usage.
- Integrating with platform services (Notifications, Media, Sensors).

## Core Technologies

### Jetpack Compose

- Use `State` and `MutableState` for UI reactivity.
- Leverage `CompositionLocal` for themed constants.
- Avoid heavy computation inside `@Composable` functions; use `LaunchedEffect`.

### Kotlin Coroutines

- Use `viewModelScope` for UI-bound async tasks.
- Prefer `Flow` for reactive data streams from repositories.
- Use `withContext(Dispatchers.IO)` for blocking operations.

### Dependency Injection

- Use Hilt for standardized Android DI.
- Annotate ViewModels with `@HiltViewModel`.

## Best Practices

- **MVI/MVVM**: Maintain a strict separation between UI state and business logic.
- **Material 3**: Follow modern Material Design guidelines for accessibility and aesthetics.
- **Testing**: Use `ComposeTestRule` for UI testing and `MockK` for unit tests.

## Checklist

- [ ] UI is responsive and follows Material 3 guidelines.
- [ ] Business logic is decoupled from ViewModels.
- [ ] Coroutines are properly scoped and handled.
- [ ] Resources (Strings, Colors) are externalized.
