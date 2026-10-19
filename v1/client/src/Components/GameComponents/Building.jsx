import { Container, Sprite } from '@inlet/react-pixi/animated'
import { ColorReplaceFilter } from 'pixi-filters';
import { Texture } from 'pixi.js'
import React, { useEffect } from 'react'
import { PLAYER_COLORS } from '../../config';
import { Spring } from 'react-spring'


export default function Building(props) {
  const { ownerColor } = props

  const haz_alap = Texture.from('../Images/game/characters/haz_alap.png');
  const haz_resz = Texture.from('../Images/game/characters/haz_resz.png');
  const haz_teto = Texture.from('../Images/game/characters/haz_teto.png');

  const colorFilter = new ColorReplaceFilter()
  colorFilter.originalColor = 0xD8D2BE
  colorFilter.newColor = (ownerColor !== null) ? PLAYER_COLORS[ownerColor].color : 0xfff
  colorFilter.epsilon = 1

  const spring = { mass: 10, tension: 1000, friction: 350 }

  let emeletek = []

  for (let i = 0; i < props.currentLevel; i++) {
    if (i === 0) {
      emeletek.push(
        <Spring key={i} native from={{ y: -1000 }} to={{ y: -32 * i - 1 }} config={spring}>
          {props => <Sprite
            filters={[colorFilter]}
            texture={haz_alap}
            anchor={0.5}
            scale={{ x: (props.flip ? 1 : -1) * 1, y: 1 }}
            {...props}
          />}
        </Spring>
      )
    } else {
      emeletek.push(
        <Spring key={i} native from={{ y: -1000 }} to={{ y: -32 * i }} config={spring}>
          {props => (
            <Sprite
              filters={[colorFilter]}
              texture={haz_resz}
              anchor={0.5}
              scale={{ x: (props.flip ? 1 : -1) * 1, y: 1 }}
              {...props}
            />)}
        </Spring>
      )
    }
  }
  if (props.currentLevel > 0) {
    emeletek.push(
      <Spring key={'teto'} native from={{ y: -1000 }} to={{ y: -32 * props.currentLevel + 16 }} config={spring}>
        {props => (
          <Sprite
            filters={[colorFilter]}
            texture={haz_teto}
            anchor={0.5}
            scale={{ x: (props.flip ? 1 : -1) * 1, y: 1 }}
            {...props}
          />)}
      </Spring>
    )
  }


  return (
    <>
      <Container
        anchor={0.5}
        {...props}
      >
        {emeletek}

      </Container>
    </>
  )
}
