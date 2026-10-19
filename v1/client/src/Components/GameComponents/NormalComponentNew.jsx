import { Container, Sprite, Text } from '@inlet/react-pixi/animated'
import React, { useEffect, useState } from 'react'
import * as PIXI from 'pixi.js'
import { ColorReplaceFilter, MultiColorReplaceFilter } from 'pixi-filters';
import PropTypes from 'prop-types';
import { GROUP_COLORS, PLAYER_COLORS } from '../../config';
import { TextStyle } from 'pixi.js';
import { GAME_CONFIG } from '../../gameConfig';
import { Spring } from 'react-spring'

import Building from './Building';
import calcPrice from '../../Utils/calcPrice'
import { addSelection, putDoublerTo, nextPlayer, setDiceRollValue, setSelectErasmus, setShowErasmus, setShowBuyPanel } from '../../Store/slices/gameStateSlice';
import _ from 'lodash';
import { useSocket } from '../../Contexts/SocketContext';


export default function NormalComponentNew(props) {
  const { id, fields, dispatch, players, currentPlayer, showDisabledFields, disabledFilter, selectedFilter, singleSelecting, multipleSelecting, selectedFields, onlyOwnField, selectDoubler, selectErasmus, showSell, RoundOnMe } = props
  const [level, setLevel] = useState(fields[id].level)
  const [ownerColor, setOwnerColor] = useState(fields[id].ownerColor)
  const [filters, setFilters] = useState([])
  const [selectable, setSelectable] = useState(false)
  const [isPointerDown, setIsPointerDown] = useState(false)
  const [hasDoubler, setHasDoubler] = useState(fields[id].hasDoubler)
  const socket = useSocket()

  useEffect(() => {
    socket.off('select_field_res').on('select_field_res', (data) => { if (true) select(data) })
  })


  useEffect(() => {
    setOwnerColor(fields[id].ownerColor)
    setLevel(fields[id].level)
    setHasDoubler(fields[id].hasDoubler)
  }, [fields])


  useEffect(() => {
    if (showDisabledFields) {
      if (onlyOwnField) {
        if (ownerColor === currentPlayer) {
          setSelectable(true)
          setFilters([])
        } else {
          setFilters([disabledFilter])
        }
      } else {

        if (ownerColor === null || ownerColor === currentPlayer) {
          setSelectable(true)
          setFilters([])
        } else {
          setFilters([disabledFilter])
        }
      }
    }

    return () => {
      setSelectable(false)
      setFilters([])

    }
  }, [showDisabledFields, currentPlayer])

  useEffect(() => {
    if (selectedFields.includes(id)) {
      filters.push(selectedFilter)
    } else {
      _.remove(filters, (n) => n === selectedFilter)
    }

    return () => {
      _.remove(filters, (n) => n === selectedFilter)
    }
  }, [selectedFields])




  const formater = new Intl.NumberFormat('en-GB', { notation: 'compact' })


  const label_bg = PIXI.Texture.from('../Images/game/isometriccity/PNG/cityTiles_072.png');
  const ehh = PIXI.Texture.from('../Images/game/isometriclandscape/PNG/landscapeTiles_067.png');
  const doubler = PIXI.Texture.from('../Images/game/characters/doubler.png');

  const groupFilter = new ColorReplaceFilter()
  groupFilter.originalColor = 0xC2BEAC
  groupFilter.newColor = GROUP_COLORS[props.groupId].color
  groupFilter.epsilon = 0.095


  const ownerFilter = new ColorReplaceFilter()
  ownerFilter.originalColor = 0x8AB549
  ownerFilter.newColor = (fields[id].ownerColor !== null) ? PLAYER_COLORS[fields[id].ownerColor].color : 0xfff
  ownerFilter.epsilon = 1


  const HEIGHT = 96 / 2
  const BOTTOM_HEIGHT = 32
  const WIDTH = 129 / 2


  const calcTextCoords = (text) => {
    let foo = text.toString().trim()
    if (foo.includes(' ') && foo.length > 9) {
      return { x: -33, y: 7 }
    } else {
      return { x: -50, y: 14 }
    }
  }
  const textCoords = calcTextCoords(props.label)

  const select = (id) => {
    if (RoundOnMe) emitSelect(id)
    if (multipleSelecting) {
      dispatch(addSelection(id))
    } else if (singleSelecting) {
      if (selectDoubler) {
        console.log('submit');
        dispatch(putDoublerTo(id))

        setTimeout(() => {
          dispatch(nextPlayer())
        }, 1000);
      } else if (selectErasmus) {

        let diff = id - players[currentPlayer].field % 32
        if (diff < 0) diff += 32
        dispatch(setDiceRollValue(diff))
        dispatch(setShowErasmus(false))
        dispatch(setSelectErasmus(false))
        dispatch(setShowBuyPanel(false))
      }

    }
  }
  const emitSelect = (id) => {
    socket.emit('select_field_req', id)
  }

  const pointerDown = (e) => {
    if (selectable && RoundOnMe) setIsPointerDown(true)
  }

  const pointerUp = (e) => {

    if (isPointerDown) {
      select(id)
    }
  }

  const pointerUpOutside = (e) => {
    if (RoundOnMe) setIsPointerDown(false)

  }

  const pointerCancel = (e) => {
    if (RoundOnMe) setIsPointerDown(false)
  }



  return (
    <Container
      sortableChildren
      anchor={0.5}
      scale={{ x: (props.flip ? -1 : 1) * GAME_CONFIG.scale, y: GAME_CONFIG.scale }}
      interactive={true}
      filters={filters}
      //pointerdown={(e) => e.currentTarget.y -= 10}
      //pointerup={(e) => e.currentTarget.y += 10}
      //pointerout={(e) => e.currentTarget.y += 10}
      pointerdown={pointerDown}
      pointerupoutside={pointerUpOutside}
      pointerup={pointerUp}
      pointercancel={pointerCancel}

      {...props}
      x={props.x}
      y={props.y - (selectable ? 15 : 0)}
    >
      <Container
        zIndex={90}
        scale={[1, 1.2]}
        rotation={Math.PI / 6.66667}
        anchor={0.5}
        x={textCoords.x}
        y={textCoords.y}
        pointerdown={pointerDown}
        pointerupoutside={pointerUpOutside}
        pointerup={pointerUp}
        pointercancel={pointerCancel}
      >


        <Text
          zIndex={90}
          text={props.label.toUpperCase()} //  new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(1190000)
          anchor={0.5}
          skew={[-Math.PI / 4, 0]}
          scale={{ x: (props.flip ? -1 : 1) * 1, y: 1 }}
          // skew={[0.6, -0.3]}
          style={
            new TextStyle({
              // align: 'center',
              // breakWords: true,
              // trim: true,
              // fontFamily: "'Nunoto', sans-serif",
              // fontWeight: 700,
              // fontSize: 40,
              // letterSpacing: 0,
              // fill: ['#000000'], // gradient
              // stroke: '#ffffff',
              // strokeThickness: 10,
              // // dropShadow: true,
              // // dropShadowColor: '#ccced2',
              // // dropShadowBlur: 1,
              // // dropShadowAngle: Math.PI / 6,
              // // dropShadowDistance: 1,
              // // wordWrap: true,
              // // wordWrapWidth: 440,
              align: 'center',
              fontFamily: 'Arial',
              fill: ['#000000'],
              stroke: '#eeeeee',
              fontSize: 22,
              fontWeight: 'bold',
              lineJoin: 'round',
              strokeThickness: 4,
              wordWrap: true,
              wordWrapWidth: 150,
              breakWords: false,
              lineHeight: 30
            })
          }

        />
      </Container>

      <Container
        zIndex={90}
        scale={[1, 1.2]}
        rotation={Math.PI / 6.66667}
        anchor={0.5}
        x={-105}
        y={43}
      >


        <Text
          zIndex={90}
          text={(level !== 0 && level !== null) ? ((showSell && selectable) ? formater.format(calcPrice(id, level, fields).sellToBank) : formater.format(calcPrice(id, level, fields).tandij)) : ''} //  new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(1190000)
          anchor={0.5}
          skew={[-Math.PI / 4, 0]}
          scale={{ x: (props.flip ? -1 : 1) * 1, y: 1 }}
          // skew={[0.6, -0.3]}
          style={
            new TextStyle({
              // align: 'center',
              // breakWords: true,
              // trim: true,
              // fontFamily: "'Nunoto', sans-serif",
              // fontWeight: 700,
              // fontSize: 40,
              // letterSpacing: 0,
              // fill: ['#000000'], // gradient
              // stroke: '#ffffff',
              // strokeThickness: 10,
              // // dropShadow: true,
              // // dropShadowColor: '#ccced2',
              // // dropShadowBlur: 1,
              // // dropShadowAngle: Math.PI / 6,
              // // dropShadowDistance: 1,
              // // wordWrap: true,
              // // wordWrapWidth: 440,
              align: 'center',
              fontFamily: 'Arial',
              fill: ['#000000'],
              stroke: '#eeeeee',
              fontSize: 45,
              fontWeight: 'bold',
              lineJoin: 'round',
              strokeThickness: 4,
              wordWrap: true,
              wordWrapWidth: 150,
              breakWords: false,
              textBaseline: 'bottom',
              lineHeight: 30
            })
          }
        />
      </Container>


      <Sprite
        anchor={0.5}
        zIndex={2}
        scale={1}
        x={-WIDTH}
        y={+ HEIGHT + HEIGHT / 2}
        texture={label_bg}
        filters={[(props.groupId && groupFilter)]}
      />
      <Sprite
        anchor={0.5}
        zIndex={1}
        scale={1}
        x={-WIDTH * 2 + 1}
        y={-BOTTOM_HEIGHT + HEIGHT + HEIGHT / 2}
        texture={label_bg}
        filters={[(props.groupId && groupFilter)]}
      />

      <Sprite
        anchor={0.5}
        zIndex={0}
        scale={1}
        x={0}
        y={-BOTTOM_HEIGHT + HEIGHT + HEIGHT / 2}
        texture={ehh}
      />
      <Sprite
        anchor={0.5}
        zIndex={-1}
        scale={1}
        x={-WIDTH}
        y={-BOTTOM_HEIGHT * 2 + HEIGHT + HEIGHT / 2}
        texture={ehh}
      />

      <Sprite
        anchor={0.5}
        zIndex={-2}
        scale={1}
        x={0}
        y={-BOTTOM_HEIGHT * 3 + HEIGHT + HEIGHT / 2}
        texture={ehh}
      />
      <Sprite
        anchor={0.5}
        zIndex={-1}
        scale={1}
        x={WIDTH}
        y={-BOTTOM_HEIGHT * 2 + HEIGHT + HEIGHT / 2}
        texture={ehh}
      />
      <Building
        // filters={[ownerFilter]}
        zIndex={10}
        anchor={0.5}
        currentLevel={level}
        ownerColor={ownerColor}
        x={WIDTH / 4}
        y={-BOTTOM_HEIGHT}
        pointerdown={pointerDown}
        pointerupoutside={pointerUpOutside}
        pointerup={pointerUp}
        pointercancel={pointerCancel}
      />
      {hasDoubler &&
        <Spring native from={{ x: WIDTH, y: -2000 }} to={{ x: WIDTH, y: -BOTTOM_HEIGHT * 5 }} >
          {props => (
            <Sprite
              anchor={0.5}
              zIndex={-5}
              scale={0.93}
              texture={doubler}
              {...props}
            />
          )}
        </Spring>

      }
    </Container>
  )
}

NormalComponentNew.propTypes = {
  x: PropTypes.number,
  y: PropTypes.number,
  flip: PropTypes.bool,
  groupId: PropTypes.number
}