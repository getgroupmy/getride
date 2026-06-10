package com.taxxee.teksi.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = BrandPink,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = BrandPinkDark,
    onPrimaryContainer = androidx.compose.ui.graphics.Color.White,
    background = InkDark,
    onBackground = androidx.compose.ui.graphics.Color.White,
    surface = SurfaceDark,
    onSurface = androidx.compose.ui.graphics.Color.White,
    onSurfaceVariant = OnSurfaceMuted
)

@Composable
fun AppTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
