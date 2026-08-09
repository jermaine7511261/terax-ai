# YaMet-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _yamet_user_zdotdir="${YAMET_USER_ZDOTDIR:-$HOME}"
  [ -f "$_yamet_user_zdotdir/.zprofile" ] && source "$_yamet_user_zdotdir/.zprofile"
  unset _yamet_user_zdotdir
}
:
